// Mirrors the backend's parseProfileUrl (scraper/urls.js) so forms and the spreadsheet importer can
// give instant feedback. Keep the two in step.
const RESERVED = {
  leetcode: new Set(['problems', 'contest', 'discuss', 'explore', 'store', 'premium', 'studyplan', 'problemset', 'u', 'accounts', 'interview', 'assessment', 'subscribe', 'list']),
  hackerrank: new Set(['profile', 'domains', 'contests', 'challenges', 'dashboard', 'leaderboard', 'certificates', 'prepare', 'skills-verification', 'work', 'products', 'login']),
};
const HOSTS = { leetcode: ['leetcode.com', 'www.leetcode.com'], hackerrank: ['hackerrank.com', 'www.hackerrank.com'] };
const USERNAME_RE = /^[A-Za-z0-9_.-]{1,50}$/;

/** Returns { username } or { error }. */
export function parseProfileUrl(platform, raw) {
  const text0 = (raw || '').trim();
  if (!text0) return { error: 'URL is required' };
  let url;
  try { url = new URL(/^https?:\/\//i.test(text0) ? text0 : `https://${text0}`); } catch { return { error: 'Not a valid URL' }; }
  if (!HOSTS[platform].includes(url.hostname.toLowerCase())) return { error: `Not a ${platform === 'leetcode' ? 'LeetCode' : 'HackerRank'} link` };

  const parts = url.pathname.split('/').filter(Boolean);
  let username;
  if (platform === 'leetcode') {
    if (parts[0] === 'u' && parts[1]) username = parts[1];
    else if (parts.length >= 1 && !RESERVED.leetcode.has(parts[0].toLowerCase())) username = parts[0];
  } else if (parts[0] === 'profile' && parts[1]) username = parts[1];
  else if (parts.length === 1 && !RESERVED.hackerrank.has(parts[0].toLowerCase())) username = parts[0];

  if (!username) {
    return { error: platform === 'leetcode' ? 'This link has no username. Expected https://leetcode.com/u/<username>' : 'This link has no username. Expected https://www.hackerrank.com/profile/<username>' };
  }
  if (!USERNAME_RE.test(username)) return { error: 'The username has invalid characters' };
  return { username };
}

export function profileUrl(platform, username) {
  if (!username) return null;
  return platform === 'leetcode' ? `https://leetcode.com/u/${username}` : `https://www.hackerrank.com/profile/${username}`;
}
