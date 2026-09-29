import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestDb } from './helpers/testdb.js';
import { runTick } from '../api/services/tick.js';

const W1 = new Date('2026-09-29T19:00:00Z'); // IST 2026-09-30 00:30, window starts 18:30Z
const W2 = new Date('2026-09-30T13:00:00Z'); // IST 2026-09-30 18:30, window starts 12:30Z
const OUTSIDE = new Date('2026-09-30T06:00:00Z');
const minutes = (date, n) => new Date(date.getTime() + n * 60000);

let t;
before(async () => { t = await startTestDb(); });
after(async () => { await t.stop(); });
beforeEach(async () => {
  await t.db.query('truncate students, departments restart identity cascade');
  await t.db.query("insert into departments (name, code) values ('Computer Science', 'CSE')");
});

async function seed(count, platforms = ['leetcode']) {
  for (let i = 1; i <= count; i++) {
    const { rows: [s] } = await t.db.query("insert into students (roll_no, name, dept_id, batch_year) values ($1, $2, 1, 2028) returning id", [`R${i}`, `Student ${i}`]);
    for (const p of platforms) {
      await t.db.query('insert into platform_accounts (student_id, platform, username) values ($1, $2, $3)', [s.id, p, `${p}-user${i}`]);
    }
  }
}

function fakeFetch(handler = () => ({ status: 'ok', data: ok(10) })) {
  const calls = [];
  const fn = async (platform, username, options) => {
    calls.push(`${platform}:${username}`);
    return handler(platform, username, options);
  };
  fn.calls = calls;
  return fn;
}

const ok = (solved, rank = 1000) => ({ solvedTotal: solved, solvedEasy: 1, solvedMedium: 2, solvedHard: 3, globalRank: rank, hrStars: null });
const tick = (overrides) => runTick({ db: t.db, sleep: async () => {}, ...overrides });
const account = async (username) => (await t.db.query('select * from platform_accounts where username = $1', [username])).rows[0];

test('does nothing outside a scrape window', async () => {
  await seed(2);
  const fetchProfile = fakeFetch();
  assert.deepEqual(await tick({ now: () => OUTSIDE, fetchProfile }), { skipped: 'outside_window' });
  assert.equal(fetchProfile.calls.length, 0);
});

test('scrapes due accounts on both platforms and stores snapshots for the IST day', async () => {
  await seed(3, ['leetcode', 'hackerrank']);
  const fetchProfile = fakeFetch();
  const summary = await tick({ now: () => W1, fetchProfile });

  assert.equal(summary.leetcode.ok, 3);
  assert.equal(summary.hackerrank.ok, 3);
  const { rows } = await t.db.query("select platform, snap_date::text as day, solved_total from snapshots order by id");
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.day === '2026-09-30' && r.solved_total === 10));
  assert.ok((await account('leetcode-user1')).last_ok_at);
});

test('passes single-attempt options so one tick cannot exceed the request limit', async () => {
  await seed(1);
  const seen = [];
  await tick({ now: () => W1, fetchProfile: fakeFetch((p, u, options) => { seen.push(options); return { status: 'ok', data: ok(1) }; }) });
  assert.deepEqual(seen, [{ retries: 0, timeoutMs: 7000 }]);
});

test('not_found marks the account broken and it is never retried', async () => {
  await seed(1);
  const fetchProfile = fakeFetch(() => ({ status: 'not_found' }));
  const summary = await tick({ now: () => W1, fetchProfile });
  assert.equal(summary.leetcode.not_found, 1);

  const a = await account('leetcode-user1');
  assert.equal(a.state, 'broken');
  assert.equal(a.last_error, 'Profile not found');

  await tick({ now: () => W2, fetchProfile });
  assert.equal(fetchProfile.calls.length, 1);
});

test('transient failures back off, cap at 3 attempts per window, then retry next window', async () => {
  await seed(1);
  const fetchProfile = fakeFetch(() => ({ status: 'error', error: 'HTTP 429', retryable: true }));

  await tick({ now: () => W1, fetchProfile });
  let a = await account('leetcode-user1');
  assert.equal(a.attempts, 1);
  assert.equal(a.next_retry_at.toISOString(), minutes(W1, 10).toISOString());
  assert.equal(a.state, 'active');

  await tick({ now: () => minutes(W1, 5), fetchProfile });
  assert.equal(fetchProfile.calls.length, 1, 'not due before next_retry_at');

  await tick({ now: () => minutes(W1, 10), fetchProfile });
  a = await account('leetcode-user1');
  assert.equal(a.attempts, 2);
  assert.equal(a.next_retry_at.toISOString(), minutes(W1, 30).toISOString());

  await tick({ now: () => minutes(W1, 30), fetchProfile });
  a = await account('leetcode-user1');
  assert.equal(a.attempts, 3);

  await tick({ now: () => minutes(W1, 80), fetchProfile });
  assert.equal(fetchProfile.calls.length, 3, 'gives up for this window after 3 attempts');

  await tick({ now: () => W2, fetchProfile });
  a = await account('leetcode-user1');
  assert.equal(fetchProfile.calls.length, 4, 'due again in the next window');
  assert.equal(a.attempts, 1, 'attempt counter restarts in a new window');
});

test('a thrown fetch is recorded as a retry and does not stop the lane', async () => {
  await seed(2);
  const fetchProfile = fakeFetch((p, username) => {
    if (username === 'leetcode-user1') throw new Error('boom');
    return { status: 'ok', data: ok(5) };
  });
  const summary = await tick({ now: () => W1, fetchProfile });
  assert.equal(summary.leetcode.retry, 1);
  assert.equal(summary.leetcode.ok, 1);
  assert.equal((await account('leetcode-user1')).last_error, 'boom');
});

test('the evening window updates the same day row; a later failure never overwrites a good snapshot', async () => {
  await seed(1);
  await tick({ now: () => W1, fetchProfile: fakeFetch(() => ({ status: 'ok', data: ok(10) })) });
  await tick({ now: () => W2, fetchProfile: fakeFetch(() => ({ status: 'ok', data: ok(14) })) });

  let { rows } = await t.db.query('select solved_total from snapshots');
  assert.deepEqual(rows, [{ solved_total: 14 }], 'one row per day, latest scrape wins');

  await t.db.query("update platform_accounts set last_ok_at = null, last_scraped_at = null where username = 'leetcode-user1'");
  await tick({ now: () => W2, fetchProfile: fakeFetch(() => ({ status: 'error', error: 'HTTP 500', retryable: true })) });
  ({ rows } = await t.db.query('select solved_total from snapshots'));
  assert.deepEqual(rows, [{ solved_total: 14 }]);
});

test('an account already scraped in the current window is not scraped again', async () => {
  await seed(2);
  const fetchProfile = fakeFetch();
  await tick({ now: () => W1, fetchProfile });
  await tick({ now: () => minutes(W1, 20), fetchProfile });
  assert.equal(fetchProfile.calls.length, 2);
});

test('concurrent ticks never scrape the same account twice', async () => {
  await seed(30, ['leetcode', 'hackerrank']);
  const fetchProfile = fakeFetch(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { status: 'ok', data: ok(7) };
  });
  await Promise.all([1, 2, 3].map(() => tick({ now: () => W1, fetchProfile })));

  assert.equal(fetchProfile.calls.length, 60);
  assert.equal(new Set(fetchProfile.calls).size, 60);
  assert.equal((await t.db.query('select count(*)::int as n from snapshots')).rows[0].n, 60);
});

test('a leased account is skipped until the lease expires', async () => {
  await seed(1);
  await t.db.query("update platform_accounts set claimed_until = $1", [minutes(W1, 2)]);
  const fetchProfile = fakeFetch();

  await tick({ now: () => W1, fetchProfile });
  assert.equal(fetchProfile.calls.length, 0);

  await tick({ now: () => minutes(W1, 3), fetchProfile });
  assert.equal(fetchProfile.calls.length, 1);
});

test('stops when the time budget is spent and releases the account it had claimed', async () => {
  await seed(10);
  let time = 0;
  const fetchProfile = fakeFetch(() => { time += 6000; return { status: 'ok', data: ok(1) }; });
  const summary = await tick({
    now: () => W1,
    clock: () => time,
    sleep: async (ms) => { time += ms; },
    random: () => 0.5,
    fetchProfile,
  });

  assert.equal(summary.leetcode.ok, 2);
  assert.equal(summary.leetcode.released, 1);
  assert.equal((await t.db.query('select count(*)::int as n from platform_accounts where claimed_until is not null')).rows[0].n, 0);

  time = 0;
  await tick({ now: () => W1, clock: () => time, sleep: async (ms) => { time += ms; }, random: () => 0.5, fetchProfile });
  assert.equal(new Set(fetchProfile.calls).size, fetchProfile.calls.length, 'the next tick continues with the remaining accounts');
  assert.ok(fetchProfile.calls.length > 2);
});
