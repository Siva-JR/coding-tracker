import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewRows, allRows, exportFileName } from '../web/src/lib/exportBoard.js';

const lc = (id, name, position, total, extra = {}) => ({
  position, studentId: id, name, rollNo: `R${id}`, deptCode: 'IT', batchYear: 2029, yearOfStudy: 2,
  solved: { total, easy: 1, medium: 2, hard: 3 }, globalRank: 1000 + id, stars: null, weekGain: 4, profileUrl: `https://leetcode.com/u/${name}/`, ...extra,
});
const hr = (id, name, position, total) => ({
  position, studentId: id, name, rollNo: `R${id}`, deptCode: 'IT', batchYear: 2029, yearOfStudy: 2,
  solved: { total, easy: null, medium: null, hard: null }, globalRank: null, stars: 4, weekGain: null, profileUrl: `https://www.hackerrank.com/profile/${name}`,
});

test('the view export keeps the on-screen order and true positions, with a header row', () => {
  const rows = viewRows('leetcode', [lc(2, 'Bo', 3, 50), lc(1, 'Ann', 1, 90)]);
  assert.equal(rows[0][0], 'Position');
  assert.deepEqual(rows[1].slice(0, 7), ['3', 'Bo', 'R2', 'IT', 'II', '2029', '50']);
  assert.deepEqual(rows[2].slice(0, 2), ['1', 'Ann']);
  assert.equal(rows[1].length, rows[0].length);
  const h = viewRows('hackerrank', [hr(1, 'Ann', 1, 20)]);
  assert.equal(h[0].includes('Stars'), true);
  assert.equal(h[1].length, h[0].length);
  assert.equal(h[1][7], '4', 'stars');
  assert.equal(h[1][8], '', 'unknown weekly change stays empty, never 0');
});

test('the all-students export puts both platforms in one row and keeps students who have only one', () => {
  const rows = allRows([lc(1, 'Ann', 1, 90), lc(2, 'Bo', 2, 50)], [hr(2, 'Bo', 1, 70), hr(3, 'Cy', 2, 10)]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ['Ann', 'Bo', 'Cy'], 'best LeetCode first, then HackerRank only');
  assert.equal(rows[2][5], '50');
  assert.equal(rows[2][10], '70');
  assert.equal(rows[1][10], '', 'Ann has no HackerRank data');
  assert.equal(rows[3][5], '', 'Cy has no LeetCode data');
  assert.ok(rows.every((r) => r.length === rows[0].length));
});

test('file names say what was exported', () => {
  const date = new Date('2026-10-12T08:00:00Z');
  assert.equal(exportFileName({ kind: 'view', platform: 'leetcode', top: 20, year: '2', date }), 'RMK-leetcode-top-20-II-Year-2026-10-12.xlsx');
  assert.equal(exportFileName({ kind: 'view', platform: 'hackerrank', top: null, year: 'all', date }), 'RMK-hackerrank-list-2026-10-12.xlsx');
  assert.equal(exportFileName({ kind: 'all', year: 'all', date }), 'RMK-all-students-2026-10-12.xlsx');
});
