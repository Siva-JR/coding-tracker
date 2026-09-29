# Backend Plan — Coding Performance Tracker

Companion to `PRD.md`. Section 3 is the **API contract** the frontend builds against; changes to it should be agreed between both of us.

## 1. Stack
- Node 20 / Express, deployed on Catalyst **AppSail** (30 s limit per request, instances spin down after ~5 min idle, so expect cold starts; no in-process schedulers like `node-cron`).
- Scraping is driven by a **Catalyst Cron** that calls a protected AppSail endpoint (`POST /internal/scrape/tick`, header `X-Scrape-Secret`). The tick logic is a plain function (`runTick(budgetMs)`), so it can also run from a Cron Function (15 min limit) or an external runner if Catalyst's IPs turn out to be blocked (see §10).
- Neon Postgres via `pg` with the **pooled** connection string; plain SQL migrations in `/migrations`.
- `zod` for request validation, `bcryptjs` for password hashes, `jsonwebtoken` for the session cookie.
- Env vars: `DATABASE_URL`, `SESSION_SECRET` (32+ chars), `SCRAPE_SECRET`, `SEED_PASSWORD`, `CORS_ORIGINS`, `COOKIE_SAMESITE`.

## 2. Auth and authorization
- **Two roles:** `admin` (sees everything, manages users, students and departments) and `viewer` (read-only). A viewer's access comes from **scopes**, not from a role name.
- **Scope** = one grant of a department (or all) plus an optional year of study 1-4 (or all). A viewer has one or more scopes; the all/all scope means unrestricted. Examples: Principal and Vice Chairman = one all/all scope; a HOD = their department; a 2nd-year coordinator = department + year 2; two departments = two scopes.
- **Year means year of study.** A "year 2" scope follows whoever is currently in 2nd year and moves up each June (batch year is derived, see the year helper below).
- **Enforcement is server-side.** Requesting a department or year that no single scope covers returns `403`. Requests that name neither are allowed but filtered to the user's scopes, so a HOD's landing page is simply the leaderboard with no filters.
- **Login:** username + password (bcrypt), no email. Usernames are lowercase and case-insensitive at login. 5 failed attempts lock the account for 15 minutes (`423`). Unknown user, wrong password and disabled account all return the same `401`.
- **Session:** signed JWT in an httpOnly cookie named `session` (8 h). It carries `token_version`; password change, admin password reset, role change and disabling all bump it, so existing sessions die immediately.
- **Forced password change:** accounts created or reset by an admin have `mustChangePassword: true`. Until they change it, every route except `me`, `logout` and `change-password` returns `403 PASSWORD_CHANGE_REQUIRED`. Seeded accounts do not have to change theirs.
- **CSRF guard:** every non-GET request under `/api` must send `Content-Type: application/json` (send `{}` if there is no body), otherwise `415`. CORS allows only origins listed in `CORS_ORIGINS`, with credentials. Frontend requests must use `credentials: 'include'`.
- **Cookie settings:** `SameSite=Lax` by default, `Secure` when `NODE_ENV=production`. If the frontend and API end up on different sites on Catalyst, set `COOKIE_SAMESITE=none` (HTTPS required). Verified at deploy time.
- **Seeded accounts** (`npm run seed`, password from `SEED_PASSWORD`): `admin`, `principal`, `vice.chairman` (all departments), `hod.it` (IT). The seed is idempotent and never overwrites existing accounts.
- **Last-admin protection:** the last active admin cannot be disabled or demoted (`409 LAST_ADMIN`), even by two admins acting at once.

## 3. API contract (v1)
All JSON. Errors: `{ "error": { "code", "message", ...extra } }`. Domain validation failures are `422 VALIDATION_FAILED` with `error.errors` listing every problem; malformed requests are `400 BAD_REQUEST`.

`user` object: `{ id, username, displayTitle, role, mustChangePassword, scopes: [{ deptId, deptCode, deptName, year }] }` (`null` = all; admins have `scopes: []`). Admin views of a user also include `disabled`.

### Auth
- `POST /api/auth/login` `{username, password}` → `{ user }` + cookie. Errors: `401 INVALID_CREDENTIALS`, `423 LOCKED` (`retryAfterSeconds`).
- `POST /api/auth/logout` → `204`
- `GET /api/auth/me` → `{ user }` or `401 UNAUTHENTICATED`
- `POST /api/auth/change-password` `{currentPassword, newPassword}` → `204` and a fresh cookie. Errors: `400 WRONG_PASSWORD`, `400 WEAK_PASSWORD` (min 8, max 72 bytes, not the username, not the same as current). Other sessions are signed out.

### Read (any logged-in user, scoped)
- `GET /api/departments` → `[{id, name, code}]`, only departments the user can see.
- `GET /api/leaderboard?platform=leetcode|hackerrank&sort=solved|rank&year=all|1|2|3|4&deptId=<id>&limit=20`
  - Defaults: `sort=solved`, `year=all`, `limit=20` (max 100).
  - `platform=hackerrank&sort=rank` → `400` (HackerRank sorts by problems only).
  - Response: `{ platform, sort, year, deptId, asOf, entries: [{ position, studentId, name, rollNo, deptCode, batchYear, yearOfStudy, solved: {total, easy, medium, hard}, globalRank, stars, profileUrl }] }`
  - LeetCode: easy/medium/hard and `globalRank` filled, `stars` null. HackerRank: `solved.total` is Problem Solving solved, `stars` filled, easy/medium/hard and `globalRank` null.
  - `sort=rank` orders ascending, students with no rank last. Accounts marked broken are excluded.

### Admin: users (`role: admin` only)
- `GET /api/admin/users` → `[user + disabled]`
- `POST /api/admin/users` `{username, displayTitle?, role, password?, scopes: [{deptId, year}]}` → `201 { user, temporaryPassword? }`. `temporaryPassword` is returned once, only when the server generated it. Username 3-32 chars `[a-z0-9._-]`; viewers need at least one scope; admins must have none; `409 USERNAME_TAKEN`.
- `PATCH /api/admin/users/:id` `{displayTitle?, role?, scopes?, disabled?}` → user. Changing role to `viewer` requires `scopes`; changing to `admin` clears them.
- `POST /api/admin/users/:id/reset-password` `{password?}` → `{ temporaryPassword? }`. Forces a change at next login, signs the user out everywhere, clears any lockout.
- `POST /api/admin/departments` `{name, code}` → `201` (code upper-cased, `409 DEPARTMENT_EXISTS`).

### Admin: students (`role: admin` only)
Student fields: `name, rollNo, deptId | deptCode, batchYear, leetcodeUrl, hackerrankUrl` (numbers may arrive as strings from CSV). At least one profile URL is required.
- `POST /api/admin/students` → `201 { studentId, student, accounts: [{platform, username, verified: ok|unverified, stats?}], warnings }`. Profiles are verified live: a nonexistent profile is `422`, a temporary failure is accepted with a warning, and the first snapshot is stored immediately so the student appears on the leaderboard at once. `409 ROLL_NUMBER_EXISTS`.
- `GET /api/admin/students?deptId&batchYear&q&page&pageSize` → `{ items: [student], page, pageSize, total }`. `student` = `{ id, rollNo, name, deptId, deptCode, batchYear, yearOfStudy, accounts: [{platform, username, profileUrl, state: active|broken, attempts, lastOkAt, lastError}] }` (LeetCode first). `q` searches name and roll number.
- `PATCH /api/admin/students/:id` (any subset of the fields) → `{ student, warnings }`. Changing a URL re-verifies it, deletes the old profile's snapshots and stores a fresh one; an empty string or `null` removes a profile (a student keeps at least one). Re-submitting a broken profile's URL re-verifies and reactivates it.
- `DELETE /api/admin/students/:id` → `204`
- `POST /api/admin/students/:id/refresh` → `{ student, results: [{platform, username, status: ok|not_found|error, stats?, error?}] }`. A missing profile is marked broken; a temporary failure changes nothing.
- **CSV import is two steps, and the frontend parses the CSV.**
  - `POST /api/admin/students/validate` `{rows: [≤10]}` → `{ results: [{index, checked, ok, errors, warnings, accounts}] }`. Nothing is written. Rows the time budget could not reach come back `checked: false`; resend them. Duplicate roll numbers within the file and already in the database are flagged.
  - `POST /api/admin/students/import` `{rows: [≤200]}` → `{ created: [{index, studentId, rollNo}], skipped: [{index, rollNo, reason}] }`. Each row is independent. It does not fetch profiles; the accounts are picked up by the next scrape window (or use `refresh`).

### Scrape trigger (not for browsers)
- `POST /internal/scrape/tick` with header `X-Scrape-Secret`. Called by Catalyst Cron.

### Derived "year of study" (single implementation, used by leaderboard, scopes and student lists)
Academic year starts in June. `endYear = month >= 6 ? thisYear + 1 : thisYear`; `yearOfStudy = 4 - (batchYear - endYear)`. Example (Sept 2026): batch 2028 → 3rd year, 2029 → 2nd, 2030 → 1st, 2027 → 4th. Assumes 4-year programmes.

## 4. Schema (migrations)
```
departments(id, name, code unique)
staff(id, username unique lowercase, password_hash, role,        -- admin | viewer
      display_title, must_change_password, token_version, failed_attempts,
      locked_until, disabled, created_at)
staff_scopes(id, staff_id, dept_id null,                        -- null = all departments
             year null 1-4)                                     -- null = all years; unique per staff
students(id, roll_no unique, name, dept_id, batch_year, created_at)
platform_accounts(id, student_id, platform, username,           -- one row per URL = one unit of scrape work
                  state,                                        -- active | broken (profile not found)
                  attempts default 0, next_retry_at null,
                  claimed_until null,                           -- lease so overlapping ticks never take the same row
                  last_scraped_at null, last_ok_at null, last_error null,
                  unique(student_id, platform))
snapshots(id, student_id, platform, snap_date,                  -- successful fetches only
          solved_total, solved_easy, solved_medium, solved_hard,
          global_rank, hr_stars, scraped_at timestamptz,
          unique(student_id, platform, snap_date))
index snapshots(student_id, platform, snap_date desc)
```
Snapshots hold successful fetches only; failures are tracked on `platform_accounts` (`attempts`, `last_error`, `state`), so a bad scrape can never overwrite a good snapshot for the same day. The leaderboard uses each student's latest snapshot (`DISTINCT ON (student_id)`) and skips accounts marked `broken`, so a failed night never blanks a student.

## 5. Scraper module (`/scraper`, shared by API validation and cron)
- `leetcode.fetch(username)` → GraphQL `matchedUser { profile.ranking, submitStatsGlobal.acSubmissionNum }`; `matchedUser == null` → `not_found`.
- `hackerrank.fetch(username)` → `GET /rest/hackers/{u}/badges`, take the `problem-solving` badge (`solved`, `stars`, `hacker_rank`).
- `parseProfileUrl(platform, url)` → username or a validation error (accepts `leetcode.com/u/<name>` and legacy `leetcode.com/<name>`; `hackerrank.com/profile/<name>`).
- Shared HTTP client: browser-like User-Agent, 10 s timeout, retry with backoff on 429/5xx (max 2), never throws — returns `{status, data|error}`.
- Both endpoints are unofficial; each fetcher is isolated so a change breaks only one platform.

## 6. Scheduled scrape (per-URL work units)
Each `platform_accounts` row is one independent unit of work. The queue is a database query, not a separate service.

**Schedule.** Two windows a day, **00:00–03:00 IST** and **18:00–21:00 IST**. Catalyst Cron calls `POST /internal/scrape/tick` every minute or two inside each window. Outside a window the endpoint returns immediately. Confirm Catalyst cron timezone support and minimum interval before deployment.

**One tick** (hard 22 s deadline: a fetch only starts if it can finish inside the budget, with a 7 s per-fetch timeout and no in-fetch retries, so the response stays inside the 30 s AppSail limit):
1. Two lanes run in parallel, one for LeetCode and one for HackerRank (different hosts).
2. Each lane repeatedly **claims one due account** and scrapes it, with a 2–4 s random pause between fetches, until the budget is spent (about 4 URLs per lane per tick).
3. "Due" means: `state='active'`, `last_scraped_at` older than the start of the current window, `next_retry_at` empty or in the past, and `claimed_until` empty or expired.
4. Claiming uses `SELECT … FOR UPDATE SKIP LOCKED` and sets `claimed_until = now() + 2 min` (a lease), so overlapping ticks never scrape the same account and a crashed tick's rows free themselves.
5. A fetch that finishes writes the snapshot and clears the lease. Unfinished claims when the budget ends are released.

**Per-URL outcomes:**
- `ok` → upsert the snapshot for `(student, platform, snap_date)`, set `last_ok_at`, reset `attempts`.
- `not_found` (profile missing or renamed) → set `state='broken'`, no retries; it shows in the "needs attention" list until an admin fixes the URL.
- Transient failure (timeout, 429, 5xx) → `attempts++`, `next_retry_at` = now + 10 min, then 20 min, then 40 min; after 3 attempts it stops for this window and is tried again in the next window. The last good snapshot stays on the leaderboard.

**Both windows** update the same `(student, platform, snap_date)` row, so the latest scrape of the day wins. Daily gain = today's final count minus the previous day's final count.

**Capacity:** ~4 URLs per lane per tick × ~60 ticks per hour ≈ 240 per lane per hour, so ~700 students per platform fit in one 3-hour window. Beyond that, lengthen the window or run more than one tick per minute.

**Logging:** each tick logs claimed / ok / not_found / retried / skipped.

## 7. Repo layout
```
/api          Express app: routes/, middleware/, services/, db.js
/scraper      leetcode.js, hackerrank.js, urls.js, http.js
/functions    AppSail entry (Express app incl. /internal/scrape/tick); netcheck (early Catalyst network test)
/migrations   001_init.sql …
/scripts      seed.js (departments + admin + staff), import-sample.js
/tests        scraper fixtures, authz matrix, leaderboard queries
```

## 8. Milestones and acceptance checks
0. **Catalyst network check (do first)** — deploy a tiny function that fetches LeetCode and HackerRank for a few real profiles from Catalyst and logs status codes and bodies. Decides where the scraper can run (see §10).
1. **Scraper + schema** — fetch both platforms for real profiles from a CLI script; migrations apply on a fresh Neon DB.
2. **Auth** — login/logout/me, lockout, token-version revocation; seed script creates admin, principal, VC and HODs.
3. **Admin student APIs** — single add, chunked validate + import; duplicate and bad-URL cases return proper errors.
4. **Leaderboards + students read** — contract in §3 implemented; year filter and rank/solved sorts verified.
5. **Scheduled scrape** — tick endpoint claims and scrapes per-URL work units on a seeded roster; two overlapping ticks never scrape the same account; killing a tick mid-way and re-running completes the rest; `not_found` marks broken, transient errors back off.
6. **Deploy** — AppSail live against Neon, Catalyst Cron wired to the tick endpoint, real roster loaded, both windows observed for a full day.

## 9. Testing
- Authorization matrix test: every route × each role (admin / institute / hod-own-dept / hod-other-dept / anonymous) asserting allow or deny. This is the most important test in the project.
- Scraper tests against saved response fixtures plus one opt-in live smoke test.
- Leaderboard tests: tie-breaks, null ranks last, stale-student fallback, year derivation across the June boundary.

## 10. Risks and assumptions
- LeetCode/HackerRank endpoints are unofficial; LeetCode's ToS prohibits scraping. Mitigated by low request rate, graceful degradation, isolated fetchers.
- **Catalyst IPs may be blocked.** The scraping endpoints were only tested from a personal machine. LeetCode blocks some automated clients, and cloud data-centre IPs can be rate-limited or refused. Milestone 0 tests this. Fallback: run only the tick from a college machine or a scheduled GitHub Actions job; the database and API stay on Catalyst since Neon is reachable from anywhere.
- AppSail docs do not state outbound network restrictions or cron's minimum interval and timezone handling; all three are verified at milestone 0 and deploy.
- **To verify at deploy time**: how the Catalyst web client and AppSail are addressed (same origin or not) — this decides whether cookie auth needs CORS with credentials; and Catalyst's actual free-tier/credit consumption for the cron.
- Pacing depends on ticks being staggered; never fan out one parallel job per URL, which would hit LeetCode all at once.
- Assumes HODs are read-only (PRD open question 4) and a 4-year programme (open question 3).
- Roster size is unknown; if over ~500 students, add the snapshot retention job (PRD §7).
