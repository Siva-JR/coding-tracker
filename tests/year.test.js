import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearOfStudy, batchYearFor, academicEndYear } from '../api/services/year.js';

test('September 2026: batch 2028 is 3rd year, 2029 is 2nd, 2030 is 1st, 2027 is 4th', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  assert.deepEqual([2027, 2028, 2029, 2030].map((b) => yearOfStudy(b, now)), [4, 3, 2, 1]);
});

test('the academic year rolls over in June', () => {
  const may = new Date('2027-05-31T12:00:00Z');
  const june = new Date('2027-06-01T12:00:00Z');
  assert.equal(yearOfStudy(2028, may), 3);
  assert.equal(yearOfStudy(2028, june), 4, 'batch 2028 moves from 3rd to final year in June 2027');
  assert.equal(academicEndYear(may), 2027);
  assert.equal(academicEndYear(june), 2028);
});

test('batchYearFor is the inverse of yearOfStudy', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  for (const year of [1, 2, 3, 4]) assert.equal(yearOfStudy(batchYearFor(year, now), now), year);
  assert.equal(batchYearFor(3, now), 2028);
});
