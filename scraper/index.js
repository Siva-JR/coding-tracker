import { fetchLeetCode } from './leetcode.js';
import { fetchHackerRank } from './hackerrank.js';
import { parseProfileUrl } from './urls.js';

export { parseProfileUrl, fetchLeetCode, fetchHackerRank };

const FETCHERS = { leetcode: fetchLeetCode, hackerrank: fetchHackerRank };

export function fetchProfile(platform, username, options) {
  const fetcher = FETCHERS[platform];
  if (!fetcher) return Promise.resolve({ status: 'error', error: `Unknown platform: ${platform}`, retryable: false });
  return fetcher(username, options);
}
