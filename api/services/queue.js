import { withTransaction } from '../db.js';
import { istDate } from './windows.js';

export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_MS = 10 * 60 * 1000;

// Atomically claims one due account for a platform by leasing it. FOR UPDATE SKIP LOCKED
// means overlapping ticks can never take the same row.
export async function claimNext(db, platform, { now, windowStart, leaseMs, maxAttempts = MAX_ATTEMPTS }) {
  const { rows } = await db.query(
    `with next as (
       select id from platform_accounts
       where platform = $1
         and state = 'active'
         and (claimed_until is null or claimed_until <= $2)
         and (last_ok_at is null or last_ok_at < $3)
         and (
           last_scraped_at is null or last_scraped_at < $3
           or (attempts < $4 and (next_retry_at is null or next_retry_at <= $2))
         )
       order by last_scraped_at nulls first, id
       limit 1
       for update skip locked
     )
     update platform_accounts pa
     set claimed_until = $5
     from next
     where pa.id = next.id
     returning pa.id, pa.student_id, pa.platform, pa.username, pa.attempts, pa.last_scraped_at`,
    [platform, now, windowStart, maxAttempts, new Date(now.getTime() + leaseMs)],
  );
  return rows[0] ?? null;
}

export function releaseClaim(db, accountId) {
  return db.query('update platform_accounts set claimed_until = null where id = $1', [accountId]);
}

export function recordSuccess(db, account, data, { now }) {
  return withTransaction(db, async (client) => {
    await client.query(
      `insert into snapshots (student_id, platform, snap_date, solved_total, solved_easy, solved_medium, solved_hard, global_rank, hr_stars, scraped_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (student_id, platform, snap_date) do update set
         solved_total = excluded.solved_total, solved_easy = excluded.solved_easy,
         solved_medium = excluded.solved_medium, solved_hard = excluded.solved_hard,
         global_rank = excluded.global_rank, hr_stars = excluded.hr_stars, scraped_at = excluded.scraped_at`,
      [account.student_id, account.platform, istDate(now), data.solvedTotal, data.solvedEasy, data.solvedMedium, data.solvedHard, data.globalRank, data.hrStars, now],
    );
    await client.query(
      `update platform_accounts
       set state = 'active', last_ok_at = $2, last_scraped_at = $2, attempts = 0, next_retry_at = null, last_error = null, claimed_until = null
       where id = $1`,
      [account.id, now],
    );
  });
}

export function recordNotFound(db, account, { now }) {
  return db.query(
    `update platform_accounts
     set state = 'broken', last_scraped_at = $2, last_error = 'Profile not found', claimed_until = null
     where id = $1`,
    [account.id, now],
  );
}

// Attempts are counted per window: the first failure in a new window starts again from zero.
export function recordTransientFailure(db, account, error, { now, windowStart }) {
  const firstInWindow = !account.last_scraped_at || account.last_scraped_at < windowStart;
  const attempts = (firstInWindow ? 0 : account.attempts) + 1;
  const nextRetryAt = new Date(now.getTime() + RETRY_BASE_MS * 2 ** (attempts - 1));
  return db.query(
    `update platform_accounts
     set attempts = $2, next_retry_at = $3, last_scraped_at = $4, last_error = $5, claimed_until = null
     where id = $1`,
    [account.id, attempts, nextRetryAt, now, String(error ?? 'Unknown error').slice(0, 300)],
  );
}
