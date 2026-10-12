// What the leaderboard's "Export Excel" writes: rows for the view on screen, or one row per student with both
// platforms side by side. Pure functions, so the layout is easy to check.
import { romanYear } from './yearOfStudy.js';

const n = (v) => (v == null ? '' : String(v));

const VIEW_HEADER = {
  leetcode: ['Position', 'Name', 'Reg no', 'Department', 'Year', 'Batch', 'Solved', 'Easy', 'Medium', 'Hard', 'Global rank', 'Last 7 days', 'Profile'],
  hackerrank: ['Position', 'Name', 'Reg no', 'Department', 'Year', 'Batch', 'Solved', 'Stars', 'Last 7 days', 'Profile'],
};
export const VIEW_WIDTHS = {
  leetcode: [10, 28, 16, 12, 8, 8, 9, 8, 9, 8, 13, 12, 44],
  hackerrank: [10, 28, 16, 12, 8, 8, 9, 8, 12, 44],
};

/** The rows on screen (same order, same positions) as a table with a header row. */
export function viewRows(platform, entries) {
  const lc = platform === 'leetcode';
  return [
    VIEW_HEADER[platform],
    ...entries.map((e) => [
      n(e.position), e.name, e.rollNo, e.deptCode, romanYear(e.yearOfStudy), n(e.batchYear), n(e.solved.total),
      ...(lc ? [n(e.solved.easy), n(e.solved.medium), n(e.solved.hard), n(e.globalRank)] : [n(e.stars)]),
      n(e.weekGain), e.profileUrl,
    ]),
  ];
}

export const ALL_HEADER = ['Name', 'Reg no', 'Department', 'Year', 'Batch', 'LeetCode solved', 'Easy', 'Medium', 'Hard', 'LeetCode global rank', 'HackerRank solved', 'HackerRank stars', 'LeetCode profile', 'HackerRank profile'];
export const ALL_WIDTHS = [28, 16, 12, 8, 8, 15, 8, 9, 8, 20, 17, 16, 44, 44];

/** One row per student with both platforms, best LeetCode first. A student missing a platform has empty cells. */
export function allRows(leetcode, hackerrank) {
  const byId = new Map();
  for (const e of leetcode) byId.set(e.studentId, { who: e, lc: e, hr: null });
  for (const e of hackerrank) {
    const row = byId.get(e.studentId);
    if (row) row.hr = e; else byId.set(e.studentId, { who: e, lc: null, hr: e });
  }
  const total = (r) => r.lc?.solved.total ?? -1;
  const list = [...byId.values()].sort((a, b) => total(b) - total(a) || (b.hr?.solved.total ?? -1) - (a.hr?.solved.total ?? -1) || a.who.name.localeCompare(b.who.name));
  return [
    ALL_HEADER,
    ...list.map(({ who, lc, hr }) => [
      who.name, who.rollNo, who.deptCode, romanYear(who.yearOfStudy), n(who.batchYear),
      n(lc?.solved.total), n(lc?.solved.easy), n(lc?.solved.medium), n(lc?.solved.hard), n(lc?.globalRank),
      n(hr?.solved.total), n(hr?.stars), lc?.profileUrl ?? '', hr?.profileUrl ?? '',
    ]),
  ];
}

/** e.g. "RMK-leetcode-top-20-II-Year-2026-10-12.xlsx" */
export function exportFileName({ kind, platform, top, year, date = new Date() }) {
  const day = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const parts = ['RMK', kind === 'all' ? 'all-students' : platform, kind === 'view' && top ? `top-${top}` : kind === 'view' ? 'list' : null, year && year !== 'all' ? `${romanYear(Number(year))}-Year` : null, day];
  return `${parts.filter(Boolean).join('-')}.xlsx`;
}
