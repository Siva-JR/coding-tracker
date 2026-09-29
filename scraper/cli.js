import { parseProfileUrl, fetchProfile } from './index.js';

const [platform, input] = process.argv.slice(2);

if (!platform || !input) {
  console.error('Usage: npm run scrape:cli -- <leetcode|hackerrank> <profile-url-or-username>');
  process.exit(1);
}

const looksLikeUrl = /^https?:\/\//i.test(input) || input.includes('/') || /(leetcode|hackerrank)\.com/i.test(input);
const parsed = looksLikeUrl ? parseProfileUrl(platform, input) : { ok: true, username: input };
if (!parsed.ok) {
  console.error(`Invalid URL: ${parsed.error}`);
  process.exit(1);
}

const started = Date.now();
const result = await fetchProfile(platform, parsed.username);
console.log(JSON.stringify({ platform, username: parsed.username, ms: Date.now() - started, ...result }, null, 2));
process.exit(result.status === 'ok' ? 0 : 2);
