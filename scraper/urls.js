const RESERVED = {
  leetcode: new Set([
    'problems', 'contest', 'discuss', 'explore', 'store', 'premium', 'studyplan',
    'problemset', 'u', 'accounts', 'interview', 'assessment', 'subscribe', 'list',
  ]),
  hackerrank: new Set([
    'profile', 'domains', 'contests', 'challenges', 'dashboard', 'leaderboard',
    'certificates', 'prepare', 'skills-verification', 'work', 'products', 'login',
  ]),
};

const HOSTS = {
  leetcode: ['leetcode.com', 'www.leetcode.com'],
  hackerrank: ['hackerrank.com', 'www.hackerrank.com'],
};

const USERNAME_RE = /^[A-Za-z0-9_.-]{1,50}$/;

const fail = (error) => ({ ok: false, error });

export function parseProfileUrl(platform, raw) {
  if (!HOSTS[platform]) return fail(`Unknown platform: ${platform}`);
  if (typeof raw !== 'string' || !raw.trim()) return fail('URL is empty');

  let text = raw.trim();
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return fail('Not a valid URL');
  }

  if (!HOSTS[platform].includes(url.hostname.toLowerCase())) {
    return fail(`Not a ${platform} URL`);
  }

  const parts = url.pathname.split('/').filter(Boolean);
  let username;

  if (platform === 'leetcode') {
    if (parts[0] === 'u' && parts[1]) username = parts[1];
    else if (parts.length >= 1 && !RESERVED.leetcode.has(parts[0].toLowerCase())) username = parts[0];
  } else if (parts[0] === 'profile' && parts[1]) {
    username = parts[1];
  } else if (parts.length === 1 && !RESERVED.hackerrank.has(parts[0].toLowerCase())) {
    username = parts[0];
  }

  if (!username) return fail(`Could not find a username in the ${platform} URL`);
  if (!USERNAME_RE.test(username)) return fail('Username contains invalid characters');

  return { ok: true, username };
}
