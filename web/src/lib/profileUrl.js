// Mirrors the backend's parseProfileUrl so the forms can give instant feedback.
const RESERVED = new Set(['problems', 'contest', 'explore', 'discuss', 'store', 'u', 'profile', 'domains', 'leaderboard']);

const PATTERNS = {
  leetcode: /^https?:\/\/(?:www\.)?leetcode\.com\/(?:u\/)?([A-Za-z0-9_-]{2,40})\/?$/i,
  hackerrank: /^https?:\/\/(?:www\.)?hackerrank\.com\/(?:profile\/)?([A-Za-z0-9_]{2,40})\/?$/i,
};

export function parseProfileUrl(platform, url) {
  const raw = (url || '').trim();
  if (!raw) return { error: 'URL is required' };
  const m = PATTERNS[platform].exec(raw);
  if (!m || RESERVED.has(m[1].toLowerCase())) {
    return {
      error:
        platform === 'leetcode'
          ? 'Expected https://leetcode.com/u/<username>'
          : 'Expected https://www.hackerrank.com/profile/<username>',
    };
  }
  return { username: m[1] };
}

export function profileUrl(platform, username) {
  if (!username) return null;
  return platform === 'leetcode'
    ? `https://leetcode.com/u/${username}`
    : `https://www.hackerrank.com/profile/${username}`;
}
