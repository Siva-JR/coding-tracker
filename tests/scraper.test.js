import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProfileUrl } from '../scraper/urls.js';
import { parseLeetCode } from '../scraper/leetcode.js';
import { parseHackerRank } from '../scraper/hackerrank.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('parseProfileUrl: leetcode accepted formats', () => {
  for (const input of [
    'https://leetcode.com/u/2mNZWXqhCg/',
    'https://leetcode.com/u/2mNZWXqhCg',
    'leetcode.com/u/2mNZWXqhCg',
    'https://www.leetcode.com/u/2mNZWXqhCg/?envType=daily',
    'https://leetcode.com/2mNZWXqhCg/',
    '  https://leetcode.com/u/2mNZWXqhCg/  ',
  ]) {
    assert.deepEqual(parseProfileUrl('leetcode', input), { ok: true, username: '2mNZWXqhCg' }, input);
  }
});

test('parseProfileUrl: leetcode rejects non-profile URLs', () => {
  for (const input of [
    '', '   ', 'not a url', 'https://leetcode.com/problems/two-sum/', 'https://leetcode.com/contest/',
    'https://leetcode.com/', 'https://leetcode.com/u/', 'https://example.com/u/abc', 'https://hackerrank.com/profile/abc',
  ]) {
    assert.equal(parseProfileUrl('leetcode', input).ok, false, input);
  }
  assert.equal(parseProfileUrl('leetcode', null).ok, false);
});

test('parseProfileUrl: hackerrank accepted formats', () => {
  for (const input of [
    'https://www.hackerrank.com/profile/kevinsogo',
    'https://hackerrank.com/profile/kevinsogo/',
    'hackerrank.com/profile/kevinsogo',
    'https://www.hackerrank.com/kevinsogo',
  ]) {
    assert.deepEqual(parseProfileUrl('hackerrank', input), { ok: true, username: 'kevinsogo' }, input);
  }
  assert.deepEqual(parseProfileUrl('hackerrank', 'https://www.hackerrank.com/profile/john.doe_1'), { ok: true, username: 'john.doe_1' });
});

test('parseProfileUrl: hackerrank rejects non-profile URLs', () => {
  for (const input of [
    'https://www.hackerrank.com/', 'https://www.hackerrank.com/domains/algorithms', 'https://www.hackerrank.com/profile/',
    'https://leetcode.com/u/abc', 'https://www.hackerrank.com/profile/bad%20name',
  ]) {
    assert.equal(parseProfileUrl('hackerrank', input).ok, false, input);
  }
});

test('parseProfileUrl: unknown platform', () => {
  assert.equal(parseProfileUrl('github', 'https://github.com/x').ok, false);
});

test('parseLeetCode: maps solved counts and rank', () => {
  assert.deepEqual(parseLeetCode(fixture('leetcode-user.json')), {
    status: 'ok',
    username: '2mNZWXqhCg',
    data: { solvedTotal: 414, solvedEasy: 319, solvedMedium: 90, solvedHard: 5, globalRank: 302658, hrStars: null },
  });
});

test('parseLeetCode: unknown user is not_found', () => {
  assert.deepEqual(parseLeetCode(fixture('leetcode-not-found.json')), { status: 'not_found' });
});

test('parseLeetCode: rank 0 becomes null', () => {
  const json = fixture('leetcode-user.json');
  json.data.matchedUser.profile.ranking = 0;
  assert.equal(parseLeetCode(json).data.globalRank, null);
});

test('parseHackerRank: uses the Problem Solving badge', () => {
  assert.deepEqual(parseHackerRank(fixture('hackerrank-badges.json'), 'kevinsogo'), {
    status: 'ok',
    username: 'kevinsogo',
    data: { solvedTotal: 137, solvedEasy: null, solvedMedium: null, solvedHard: null, globalRank: 2305, hrStars: 6 },
  });
});

test('parseHackerRank: no Problem Solving badge means zero solved', () => {
  const json = { status: true, models: [{ badge_type: 'python', solved: 3 }] };
  const result = parseHackerRank(json, 'newbie');
  assert.equal(result.status, 'ok');
  assert.equal(result.data.solvedTotal, 0);
  assert.equal(result.data.globalRank, null);
});

test('parseHackerRank: unexpected shape is a non-retryable error', () => {
  assert.deepEqual(parseHackerRank({ error: 'x' }, 'u'), {
    status: 'error', error: 'Unexpected HackerRank response shape', retryable: false,
  });
});
