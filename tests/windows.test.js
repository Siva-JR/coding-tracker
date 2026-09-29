import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentWindow, istDate } from '../api/services/windows.js';

const at = (iso) => new Date(iso);

test('currentWindow: inside the midnight window (IST 00:30)', () => {
  const w = currentWindow(at('2026-09-29T19:00:00Z'));
  assert.equal(w.start.toISOString(), '2026-09-29T18:30:00Z'.replace('Z', '.000Z'));
  assert.equal(w.end.toISOString(), '2026-09-29T21:30:00.000Z');
});

test('currentWindow: inside the evening window (IST 18:30)', () => {
  const w = currentWindow(at('2026-09-30T13:00:00Z'));
  assert.equal(w.start.toISOString(), '2026-09-30T12:30:00.000Z');
  assert.equal(w.end.toISOString(), '2026-09-30T15:30:00.000Z');
});

test('currentWindow: boundaries are start-inclusive, end-exclusive', () => {
  assert.ok(currentWindow(at('2026-09-29T18:30:00Z')));
  assert.equal(currentWindow(at('2026-09-29T21:30:00Z')), null);
  assert.ok(currentWindow(at('2026-09-30T12:30:00Z')));
  assert.equal(currentWindow(at('2026-09-30T15:30:00Z')), null);
});

test('currentWindow: outside any window (IST 11:30)', () => {
  assert.equal(currentWindow(at('2026-09-30T06:00:00Z')), null);
});

test('istDate: uses the IST calendar day', () => {
  assert.equal(istDate(at('2026-09-29T19:00:00Z')), '2026-09-30');
  assert.equal(istDate(at('2026-09-30T12:30:00Z')), '2026-09-30');
  assert.equal(istDate(at('2026-09-30T18:29:00Z')), '2026-09-30');
  assert.equal(istDate(at('2026-09-30T18:30:00Z')), '2026-10-01');
});
