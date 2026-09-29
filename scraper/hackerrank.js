import { requestJson } from './http.js';

const badgesUrl = (username) => `https://www.hackerrank.com/rest/hackers/${encodeURIComponent(username)}/badges`;

export function parseHackerRank(json, username) {
  const models = json?.models;
  if (!Array.isArray(models)) return { status: 'error', error: 'Unexpected HackerRank response shape', retryable: false };

  const badge = models.find((m) => m.badge_type === 'problem-solving');

  return {
    status: 'ok',
    username,
    data: {
      solvedTotal: badge?.solved ?? 0,
      solvedEasy: null,
      solvedMedium: null,
      solvedHard: null,
      globalRank: badge?.hacker_rank ?? null,
      hrStars: badge?.stars ?? null,
    },
  };
}

// Never throws. Resolves to { status: 'ok'|'not_found'|'error', ... }.
export async function fetchHackerRank(username, options = {}) {
  const res = await requestJson(badgesUrl(username), options);
  if (!res.ok) {
    if (res.status === 404) return { status: 'not_found' };
    return { status: 'error', error: res.error, retryable: res.retryable };
  }
  return parseHackerRank(res.data, username);
}
