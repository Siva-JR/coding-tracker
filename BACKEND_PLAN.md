# Backend Plan — Coding Performance Tracker

Companion to `PRD.md`. Section 3 is the **API contract** the frontend builds against; changes to it should be agreed between both of us.

## 1. Stack
- Node 18+ / Express, deployed as a Catalyst **Advanced I/O function** (30 s limit per request).
- Scraper deployed as a Catalyst **Cron function** (15 min limit per run).
- Neon Postgres via `pg` with the **pooled** connection string; plain SQL migrations in `/migrations`.
- `zod` for request validation, `bcryptjs` for password hashes, signed session cookie (JWT).
- Env vars: `DATABASE_URL`, `SESSION_SECRET`.

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
- `PATCH /api/admin/students/:id`, `DELETE /api/admin/students/:id`
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
students(id, roll_no unique, name, dept_id, batch_year,
         leetcode_username, hackerrank_username, created_at)
snapshots(id, student_id, platform, snap_date, status,          -- ok | not_found | error
          solved_total, solved_easy, solved_medium, solved_hard,
          global_rank, hr_stars, error_message,
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

## 6. Nightly cron (`/functions/nightly-scrape`)
- Schedule: every 15 minutes, 01:00–05:00 IST.
- Each run: select (student, platform) pairs lacking today's snapshot; process until ~12 min elapsed (stay under the 15 min cap), then exit cleanly.
- LeetCode and HackerRank queues run **in parallel** (different hosts), each sequential with 2–4 s random gap between requests.
- Writes one snapshot row per fetch (`ok`/`not_found`/`error`); idempotent thanks to the unique key, so re-runs are safe.
- Logs a summary per run (attempted / ok / failed / remaining).
- Capacity: ~240 fetches per platform per run, ~16 runs → several thousand per night; comfortably above the expected roster.

## 7. Repo layout
```
/api          Express app: routes/, middleware/, services/, db.js
/scraper      leetcode.js, hackerrank.js, urls.js, http.js
/functions    api (Advanced I/O entry), nightly-scrape (cron entry)
/migrations   001_init.sql …
/scripts      seed.js (departments + admin + staff), import-sample.js
/tests        scraper fixtures, authz matrix, leaderboard queries
```

## 8. Milestones and acceptance checks
1. **Scraper + schema** — fetch both platforms for real profiles from a CLI script; migrations apply on a fresh Neon DB.
2. **Auth** — login/logout/me, lockout, token-version revocation; seed script creates admin, principal, VC and HODs.
3. **Admin student APIs** — single add, chunked validate + import; duplicate and bad-URL cases return proper errors.
4. **Leaderboards + students read** — contract in §3 implemented; year filter and rank/solved sorts verified.
5. **Cron** — chunked run processes a seeded roster; killing a run mid-way and re-running completes the rest.
6. **Deploy** — Catalyst functions live against Neon, real roster loaded, one full night observed.

## 9. Testing
- Authorization matrix test: every route × each role (admin / institute / hod-own-dept / hod-other-dept / anonymous) asserting allow or deny. This is the most important test in the project.
- Scraper tests against saved response fixtures plus one opt-in live smoke test.
- Leaderboard tests: tie-breaks, null ranks last, stale-student fallback, year derivation across the June boundary.

## 10. Risks and assumptions
- LeetCode/HackerRank endpoints are unofficial; LeetCode's ToS prohibits scraping. Mitigated by low request rate, graceful degradation, isolated fetchers.
- **To verify at deploy time**: how the Catalyst web client and function are addressed (same origin or not) — this decides whether cookie auth needs CORS with credentials; and Catalyst's actual free-tier/credit consumption for the cron.
- Assumes HODs are read-only (PRD open question 4) and a 4-year programme (open question 3).
- Roster size is unknown; if over ~500 students, add the snapshot retention job (PRD §7).
