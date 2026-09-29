# Coding Performance Tracker — PRD & Build Plan

Status: DRAFT for discussion · Owner: Siva

## 1. Purpose
Give college leadership daily visibility into students' LeetCode and HackerRank progress, at institute level and department level. Students never log in; staff view dashboards built from public profile data scraped nightly.

## 2. Users and access
Single auth engine: **username + password** (no email, no self-serve reset). ~13 accounts total.

| Role | Accounts | Sees | Can manage |
|---|---|---|---|
| `admin` | 1 | Everything | Students (add/edit/delete/import), staff accounts, password resets |
| `institute` | Principal, Vice Chairman | Everything (all departments) | Nothing (read-only) |
| `hod` | 10 (one per dept) | Own department only | Nothing (read-only) |

Rules:
- Scope comes from the logged-in user's row (`role`, `dept_id`), never from request parameters. A HOD cannot see another dept by editing a URL.
- Staff accounts are seeded/created by admin. Password reset = admin sets a new one.

## 3. Screens and flow

### Institute view (admin, principal, vice chairman)
- Landing page: **Top 20 across the college**, with a **LeetCode | HackerRank toggle**.
- Filter by department; click a department to drill into the dept view.

### Department view (HOD; also reachable by institute roles)
- Landing page: **Top 20 in the department**, **LeetCode | HackerRank toggle**.
- **Year tabs**: All · 1st year · 2nd year · 3rd year · (4th year).
- Student detail: name, roll no, batch, both profile links, latest stats, trend since first snapshot.
- "Needs attention" lists: broken/unfetchable profiles, inactive students.

### Admin page
- **Add student (form)**: name, roll no, department, batch, LeetCode URL, HackerRank URL.
- **Add students (CSV upload)**: same columns. Every row's URLs are validated live; result table shows OK (with solved count as proof) or the error per row. Valid rows import, invalid rows can be fixed and re-uploaded.
- Edit / delete student, manage staff accounts, reset passwords.

## 4. Metrics and ranking (decided)
- **LeetCode**: sort toggle with two options, **Problems solved (default)** and **Global rank**. Problems sort is descending by total solved, ties broken by hard, then medium. Global rank sort is ascending (lower number = better); students with no rank are placed last. Easy/medium/hard split shown as columns.
- **HackerRank**: sorted by **problems solved only** (Problem Solving domain), no rank sort option. HackerRank has no single global rank (everything is per domain), so stars are shown as an extra column only.
- Students with a missing/broken profile on a platform are excluded from that platform's leaderboard and listed under "needs attention".

## 5. Data collection
- LeetCode: public GraphQL endpoint (`matchedUser`: solved by difficulty, profile ranking).
- HackerRank: public REST endpoints (`/rest/hackers/{user}/badges` for Problem Solving solved/stars/rank).
- Both are **unofficial and can change without notice**. LeetCode's ToS prohibits scraping; keep request rate low (2–4 s gaps), and on failure keep last good data and mark the student stale instead of blanking the dashboard.
- Verified working on 2026-09-24 against live public profiles.

### Nightly job design (constraint: Catalyst cron function = 15 min max per run)
- Cron fires every ~15 min between 01:00 and 05:00 IST.
- Each run picks students without today's snapshot, processes as many as fit in ~12 minutes, then exits. Idempotent: a killed or failed run just resumes next tick.
- Capacity: ~12 min ÷ ~3 s ≈ 240 profile fetches per run × ~16 runs ≈ thousands per night. Fine for the expected roster.
- Per-student try/catch; errors recorded in `last_error`, never abort the run.

## 6. Architecture
- Frontend: React + Vite SPA on Catalyst Web Client Hosting.
- Backend: Node/Express as a Catalyst Advanced I/O function (30 s limit per request — fine for API calls; CSV import validates rows in batches from the client to stay under it).
- Cron: Catalyst Cron Function running the scraper.
- DB: Neon Postgres (free tier: 0.5 GB, 100 CU-hours/month, scale-to-zero).
- Auth: bcrypt password hashes, httpOnly signed session cookie, role middleware on every route.

## 7. Data model
- `departments` (id, name, code)
- `staff` (id, username, password_hash, role, dept_id nullable, display_title)
- `students` (id, roll_no unique, name, dept_id, batch_year, leetcode_username, hackerrank_username, created_at)
- `snapshots` (student_id, platform, date, solved_total, solved_easy, solved_medium, solved_hard, ranking, hr_stars, hr_score, status, error) — unique (student_id, platform, date)
- Year of study is **derived** from `batch_year` and today's date (never stored, so it doesn't go stale each June).
- Estimated growth: ~1 KB per snapshot row, 2 rows per student per night. 500 students ≈ 0.35 GB/year; 1,000 students ≈ 0.7 GB/year, which exceeds the free 0.5 GB in ~8 months.
- Retention policy (needed if roster > ~500): keep daily rows for the last 90 days, weekly rows afterwards.

### Neon database notes
- Free plan (per Neon docs, checked 2026-09-29): 0.5 GB storage, 100 CU-hours/month, scale-to-zero after 5 min idle. Limits can change; recheck before deployment.
- Compute is not a concern: nightly cron and dashboards use very little.
- Cold start: first dashboard load after idle is ~1 s slower. Acceptable for staff users.
- Catalyst functions open a new connection per invocation, so use Neon's **pooled connection string** (or serverless driver) from day one.
- Keep a periodic `pg_dump` export so the project is not dependent on the free plan.

## 8. Milestones
1. Scraper module + Neon schema + seed (see real data for own profile)
2. Auth + role middleware + admin seed
3. Admin: add student form + CSV import with live validation
4. Leaderboards API + Institute and Dept views (toggle, year tabs)
5. Nightly cron (chunked) + stale/broken-profile lists
6. Deploy to Catalyst, load real roster, dry-run one night
7. Later: GitHub tracking, trend charts, export to CSV

## 9. Out of scope (v1)
Student login, email, self-service password reset, GitHub, plagiarism/cheating detection (counts measure activity, not skill — tell leadership this up front), mobile app.

## 10. Open questions
1. Roster size (students total) — sizes the nightly job.
2. Confirm `department` and `roll number` are added to the student fields (needed for scoping and de-duplication).
3. Is a 4th year in scope, or only 1st–3rd?
4. Should HODs be allowed to add/edit their own students, or admin only?
5. Are LeetCode/HackerRank URLs collected via a form/sheet already?
