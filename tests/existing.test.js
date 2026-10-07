import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planForExisting, describePatch } from '../web/src/lib/existing.js';

const acc = (platform, username, state = 'active') => ({ platform, username, state });
const onFile = (accounts, githubUrl = null) => ({ id: 7, rollNo: 'R1', githubUrl, accounts });
const row = (over = {}) => ({ leetcodeUrl: '', hackerrankUrl: '', githubUrl: '', notes: [], ...over });
const improper = (platform, text = 'link has no username') => ({ platform, kind: 'improper', text: `${platform}: ${text}` });
const missing = (platform) => ({ platform, kind: 'missing', text: `${platform}: no link in the sheet` });

const LC = 'https://leetcode.com/u/asha1/';
const HR = 'https://www.hackerrank.com/profile/asha_h';

test('a student who is already complete is "already added", not a problem', () => {
  const plan = planForExisting(row({ leetcodeUrl: LC, hackerrankUrl: HR }), onFile([acc('leetcode', 'asha1'), acc('hackerrank', 'asha_h')]));
  assert.equal(plan.phase, 'exists');
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.patch, {});
  assert.deepEqual(plan.notes, []);
});

test('a link already on file is never replaced; a different one in the sheet only leaves a quiet note', () => {
  const plan = planForExisting(row({ leetcodeUrl: 'https://leetcode.com/u/someone-else' }), onFile([acc('leetcode', 'asha1'), acc('hackerrank', 'asha_h')]));
  assert.equal(plan.phase, 'exists');
  assert.deepEqual(plan.patch, {});
  assert.equal(plan.notes.length, 1);
  assert.match(plan.notes[0], /LeetCode: the sheet has a different link; the one on file was kept/);
});

test('a bad or empty cell does not matter when the record already has a working link for that platform', () => {
  const rec = onFile([acc('leetcode', 'asha1'), acc('hackerrank', 'asha_h')]);
  assert.equal(planForExisting(row({ notes: [improper('leetcode'), missing('hackerrank')] }), rec).phase, 'exists');
  assert.equal(planForExisting(row({ leetcodeUrl: 'https://leetcode.com/' }), rec).phase, 'exists', 'typed text is also ignored once the record is fine');
});

test('a record missing a link gets it added when the sheet has a proper one', () => {
  const plan = planForExisting(row({ leetcodeUrl: LC, hackerrankUrl: HR }), onFile([acc('hackerrank', 'asha_h')]));
  assert.equal(plan.phase, 'update');
  assert.deepEqual(plan.patch, { leetcodeUrl: LC });
  assert.equal(describePatch(plan.patch), 'LeetCode link');
});

test('a record missing a link needs attention when the sheet\'s link is not a proper profile link', () => {
  const rec = onFile([acc('hackerrank', 'asha_h')]);
  const fromSheet = planForExisting(row({ notes: [improper('leetcode', 'the link has no username (it points to the site, not a profile)')] }), rec);
  assert.equal(fromSheet.phase, 'fix');
  assert.match(fromSheet.errors[0], /no username/);
  const typed = planForExisting(row({ leetcodeUrl: 'https://leetcode.com/' }), rec);
  assert.equal(typed.phase, 'fix', 'the same when the bad link is typed into the table');
  assert.equal(typed.errors.length, 1);
  const dashboard = planForExisting(row({ hackerrankUrl: 'https://www.hackerrank.com/dashboard' }), onFile([acc('leetcode', 'asha1')]));
  assert.equal(dashboard.phase, 'fix');
});

test('an empty cell for a missing link adds nothing and is not a problem', () => {
  const plan = planForExisting(row({ notes: [missing('leetcode')] }), onFile([acc('hackerrank', 'asha_h')]));
  assert.equal(plan.phase, 'exists');
  assert.deepEqual(plan.errors, []);
});

test('a link on file that was not found counts as missing, so a proper new link replaces it and a bad one is flagged', () => {
  const rec = onFile([acc('leetcode', 'typo-name', 'broken'), acc('hackerrank', 'asha_h')]);
  assert.deepEqual(planForExisting(row({ leetcodeUrl: LC }), rec).patch, { leetcodeUrl: LC });
  assert.equal(planForExisting(row({ leetcodeUrl: LC }), rec).phase, 'update');
  assert.equal(planForExisting(row({ notes: [improper('leetcode')] }), rec).phase, 'fix');
});

test('one proper link and one improper link: the student still needs attention', () => {
  const plan = planForExisting(row({ leetcodeUrl: LC, notes: [improper('hackerrank')] }), onFile([]));
  assert.equal(plan.phase, 'fix');
  assert.equal(plan.errors.length, 1);
  assert.deepEqual(plan.patch, { leetcodeUrl: LC }, 'the proper one is kept ready to apply once the other is fixed');
});

test('a GitHub link fills a gap but never replaces one, and a bad one is ignored', () => {
  const full = onFile([acc('leetcode', 'asha1')], 'https://github.com/old');
  assert.equal(planForExisting(row({ githubUrl: 'https://github.com/new' }), full).phase, 'exists');
  const bare = onFile([acc('leetcode', 'asha1')], null);
  const add = planForExisting(row({ githubUrl: 'github.com/asha-dev' }), bare);
  assert.equal(add.phase, 'update');
  assert.deepEqual(add.patch, { githubUrl: 'github.com/asha-dev' });
  assert.equal(describePatch(add.patch), 'GitHub link');
  assert.equal(planForExisting(row({ githubUrl: 'GitHub' }), bare).phase, 'exists');
});

test('describePatch names what will be added', () => {
  assert.equal(describePatch({ leetcodeUrl: LC, hackerrankUrl: HR }), 'LeetCode and HackerRank links');
  assert.equal(describePatch({ hackerrankUrl: HR }), 'HackerRank link');
  assert.equal(describePatch({}), '');
});
