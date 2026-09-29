# Backend Plan — Coding Performance Tracker

Companion to `PRD.md`. Section 3 is the **API contract** the frontend builds against; changes to it should be agreed between both of us.

## 1. Stack
- Node 20 / Express, deployed on Catalyst **AppSail** (30 s limit per request, instances spin down after ~5 min idle, so expect cold starts; no in-process schedulers like `node-cron`).
- Scraping is driven by a **Catalyst Cron** that calls a protected AppSail endpoint (`POST /internal/scrape/tick`, header `X-Scrape-Secret`). The tick logic is a plain function (`runTick(budgetMs)`), so it can also run from a Cron Function (15 min limit) or an external runner if Catalyst's IPs turn out to be blocked (see §10).
- Neon Postgres via `pg` with the **pooled** connection string; plain SQL migrations in `/migrations`.
- `zod` for request validation, `bcryptjs` for password hashes, signed session cookie (JWT).
- Env vars: `DATABASE_URL`, `SESSION_SECRET`, `SCRAPE_SECRET`.

## 2. Auth and authorization
- `POST /api/auth/login` checks username + bcrypt hash, sets an **httpOnly, Secure, SameSite=Lax** cookie (8 h expiry).
- JWT payload: `{ sub, role, deptId, tokenVersion }`. `staff.token_version` is bumped on password reset or account disable, so old sessions die immediately.
- Login lockout (no email means no other recovery path): 5 failed attempts per username locks it for 15 minutes; counters stored in DB.
- Middleware chain on every protected route: `authenticate` → `requireRole(...)` → handler.
- **Scope is server-derived.** For `hod`, `deptId` always comes from the session and any `deptId` query param is ignored. `institute` and `admin` may pass any `deptId`.
- Permission matrix:

| Route group | admin | institute | hod |
|---|---|---|---|
| Leaderboards, students (read), attention lists | all depts | all depts | own dept |
| `/api/admin/*` (write) | yes | no | no |

## 3. API contract (v1)
All JSON. Errors: `{ "error": { "code": "FORBIDDEN", "message": "..." } }` with status 400/401/403/404/409.

### Auth
- `POST /api/auth/login` `{username, password}` → `{ user: {id, username, role, deptId, deptName, displayTitle} }`
- `POST /api/auth/logout` → `204`
- `GET /api/auth/me` → `{ user }` or `401`

### Reference
- `GET /api/departments` → `[{id, name, code}]` (hod gets only their own)

### Leaderboard (the landing pages)
`GET /api/leaderboard?platform=leetcode|hackerrank&sort=solved|rank&year=all|1|2|3|4&deptId=<id>&limit=20`
- Defaults: `sort=solved`, `year=all`, `limit=20`, no `deptId` = whole college (institute/admin only).
- `platform=hackerrank` with `sort=rank` → `400` (HackerRank sorts by problems only).
- Response:
```json
{
  "platform": "leetcode", "sort": "solved", "year": "all", "deptId": null,
  "asOf": "2026-09-29",
  "entries": [
    { "position": 1, "studentId": 12, "name": "…", "rollNo": "…", "deptCode": "CSE",
      "batchYear": 2028, "yearOfStudy": 3,
      "solved": {"total": 414, "easy": 319, "medium": 90, "hard": 5},
      "globalRank": 302658, "stars": null, "profileUrl": "https://leetcode.com/u/…" }
  ]
}
```
- For HackerRank: `solved.total` is Problem Solving solved, `stars` is filled, `globalRank` is null, easy/medium/hard are null.
- `sort=rank` orders ascending by `globalRank`; students with no rank go last.

### Students (read)
- `GET /api/students?deptId=&year=&q=&page=&pageSize=` → paginated list with latest stats per platform.
- `GET /api/students/:id` → profile, both platform accounts, latest stats, `history: [{date, platform, solvedTotal, globalRank}]`.
- `GET /api/attention?deptId=` → `{ broken: [...], stale: [...] }` (broken = last fetch `not_found`/`error`; stale = no successful fetch in 3 days).

### Admin (role `admin` only)
- `POST /api/admin/students` `{name, rollNo, deptId, batchYear, leetcodeUrl, hackerrankUrl}` → validates URLs live, creates student, returns the fetched stats as proof. `409` on duplicate roll number.
- `PATCH /api/admin/students/:id`, `DELETE /api/admin/students/:id`. Changing a profile URL resets that account's scrape state to `active`.
- `POST /api/admin/students/:id/refresh` → scrapes that student's LeetCode and HackerRank profiles right now (one fetch each, fits the 30 s limit) and returns the fresh stats.
- `POST /api/admin/students/validate` `{ rows: [...≤10] }` → per-row `{ok, errors[], leetcode: {username, solved}, hackerrank: {...}}`. **The frontend parses the CSV and sends it in chunks of ≤10 rows** so each call stays under the 30 s function limit.
- `POST /api/admin/students/import` `{ rows: [...] }` → inserts the validated rows in one transaction, returns `{created, skipped: [{rollNo, reason}]}`.
- `GET|POST /api/admin/staff`, `PATCH /api/admin/staff/:id`, `POST /api/admin/staff/:id/reset-password` → returns a generated temporary password once.

### Derived "year of study" (single implementation, used by leaderboard and student list)
Academic year starts in June. `endYear = month >= 6 ? thisYear + 1 : thisYear`; `yearOfStudy = 4 - (batchYear - endYear)`. Example (Sept 2026): batch 2028 → 3rd year, 2029 → 2nd, 2030 → 1st, 2027 → 4th. Assumes 4-year programmes.

## 4. Schema (migrations)
```
departments(id, name, code unique)
staff(id, username unique, password_hash, role, dept_id null, display_title,
      token_version default 0, failed_attempts default 0, locked_until null, disabled default false)
students(id, roll_no unique, name, dept_id, batch_year, created_at)
platform_accounts(id, student_id, platform, username,           -- one row per URL = one unit of scrape work
                  state,                                        -- active | broken (profile not found)
                  attempts default 0, next_retry_at null,
                  claimed_until null,                           -- lease so overlapping ticks never take the same row
                  last_scraped_at null, last_ok_at null, last_error null,
                  unique(student_id, platform))
snapshots(id, student_id, platform, snap_date, status,          -- ok | not_found | error
          solved_total, solved_easy, solved_medium, solved_hard,
          global_rank, hr_stars, error_message, scraped_at timestamptz,
          unique(student_id, platform, snap_date))
index snapshots(student_id, platform, snap_date desc)
```
Leaderboard query uses the latest `status='ok'` snapshot per student and platform (`DISTINCT ON (student_id)`), so a failed night never blanks a student.

## 5. Scraper module (`/scraper`, shared by API validation and cron)
- `leetcode.fetch(username)` → GraphQL `matchedUser { profile.ranking, submitStatsGlobal.acSubmissionNum }`; `matchedUser == null` → `not_found`.
- `hackerrank.fetch(username)` → `GET /rest/hackers/{u}/badges`, take the `problem-solving` badge (`solved`, `stars`, `hacker_rank`).
- `parseProfileUrl(platform, url)` → username or a validation error (accepts `leetcode.com/u/<name>` and legacy `leetcode.com/<name>`; `hackerrank.com/profile/<name>`).
- Shared HTTP client: browser-like User-Agent, 10 s timeout, retry with backoff on 429/5xx (max 2), never throws — returns `{status, data|error}`.
- Both endpoints are unofficial; each fetcher is isolated so a change breaks only one platform.

## 6. Scheduled scrape (per-URL work units)
Each `platform_accounts` row is one independent unit of work. The queue is a database query, not a separate service.

**Schedule.** Two windows a day, **00:00–03:00 IST** and **18:00–21:00 IST**. Catalyst Cron calls `POST /internal/scrape/tick` every minute or two inside each window. Outside a window the endpoint returns immediately. Confirm Catalyst cron timezone support and minimum interval before deployment.

**One tick** (hard budget ~20 s so the response is sent well inside the 30 s AppSail limit):
1. Two lanes run in parallel, one for LeetCode and one for HackerRank (different hosts).
2. Each lane repeatedly **claims one due account** and scrapes it, with a 2–4 s random pause between fetches, until the budget is spent (about 4 URLs per lane per tick).
3. "Due" means: `state='active'`, `last_scraped_at` older than the start of the current window, `next_retry_at` empty or in the past, and `claimed_until` empty or expired.
4. Claiming uses `SELECT … FOR UPDATE SKIP LOCKED` and sets `claimed_until = now() + 2 min` (a lease), so overlapping ticks never scrape the same account and a crashed tick's rows free themselves.
5. A fetch that finishes writes the snapshot and clears the lease. Unfinished claims when the budget ends are released.

**Per-URL outcomes:**
- `ok` → upsert the snapshot for `(student, platform, snap_date)`, set `last_ok_at`, reset `attempts`.
- `not_found` (profile missing or renamed) → set `state='broken'`, no retries; it shows in the "needs attention" list until an admin fixes the URL.
- Transient failure (timeout, 429, 5xx) → `attempts++`, `next_retry_at = now + 10 min × 2^attempts`; after 3 attempts it stops for this window and is tried again in the next window. The last good snapshot stays on the leaderboard.

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
