// What an uploaded row means for a student who is ALREADY in the system.
//
// An existing student is not a problem. The row is only worth acting on when it can fill a gap:
//   - the record has no working link for a platform and the sheet gives a proper one  -> add it ("update")
//   - the record has no working link for a platform and the sheet gives one that is not a proper profile
//     link (a homepage, a dashboard, text)                                            -> needs attention ("fix")
//   - everything else (record already complete, or the sheet adds nothing)           -> "exists", nothing to do
// A working link already on file is never replaced by whatever the sheet says; if the sheet disagrees the
// student gets a quiet note instead.
import { parseProfileUrl } from './profileUrl.js';
import { checkGithubUrl } from './github.js';

const PLATFORMS = [['leetcode', 'leetcodeUrl', 'LeetCode'], ['hackerrank', 'hackerrankUrl', 'HackerRank']];

/**
 * row: a parsed sheet row ({ leetcodeUrl, hackerrankUrl, githubUrl, notes }).
 * existing: the student on file ({ id, accounts: [{ platform, username, state }], githubUrl }).
 * Returns { phase: 'exists' | 'update' | 'fix', patch, errors, notes }.
 */
export function planForExisting(row, existing) {
  const patch = {};
  const errors = [];
  const notes = [];

  for (const [platform, field, label] of PLATFORMS) {
    const acc = existing.accounts?.find((a) => a.platform === platform);
    const working = !!acc && acc.state === 'active';
    const typed = (row[field] || '').trim();
    const parsed = typed ? parseProfileUrl(platform, typed) : null;
    const improperCell = (row.notes || []).find((n) => n.platform === platform && n.kind === 'improper');

    if (working) {
      if (parsed && !parsed.error && parsed.username.toLowerCase() !== acc.username.toLowerCase()) {
        notes.push(`${label}: the sheet has a different link; the one on file was kept`);
      }
      continue;
    }
    // No working link on file for this platform.
    if (parsed && !parsed.error) patch[field] = typed;
    else if (parsed) errors.push(`${label}: ${parsed.error}`);
    else if (improperCell) errors.push(improperCell.text);
    // an empty cell adds nothing and is not a problem
  }

  const gh = (row.githubUrl || '').trim();
  if (gh && !existing.githubUrl && !checkGithubUrl(gh)) patch.githubUrl = gh;

  const phase = errors.length ? 'fix' : Object.keys(patch).length ? 'update' : 'exists';
  return { phase, patch, errors, notes };
}

/** "LeetCode link" / "LeetCode and HackerRank links" for a patch */
export function describePatch(patch) {
  const names = [];
  if (patch.leetcodeUrl) names.push('LeetCode');
  if (patch.hackerrankUrl) names.push('HackerRank');
  if (patch.githubUrl) names.push('GitHub');
  if (!names.length) return '';
  return `${names.join(' and ')} link${names.length > 1 ? 's' : ''}`;
}
