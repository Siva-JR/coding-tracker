import { requestJson } from './http.js';

const ENDPOINT = 'https://leetcode.com/graphql';

const QUERY = `
query userStats($username: String!) {
  matchedUser(username: $username) {
    username
    profile { ranking }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
}`;

export function parseLeetCode(json) {
  const user = json?.data?.matchedUser;
  if (!user) return { status: 'not_found' };

  const counts = Object.fromEntries(
    (user.submitStatsGlobal?.acSubmissionNum ?? []).map((row) => [row.difficulty, row.count]),
  );
  const ranking = user.profile?.ranking;

  return {
    status: 'ok',
    username: user.username,
    data: {
      solvedTotal: counts.All ?? 0,
      solvedEasy: counts.Easy ?? 0,
      solvedMedium: counts.Medium ?? 0,
      solvedHard: counts.Hard ?? 0,
      globalRank: ranking > 0 ? ranking : null,
      hrStars: null,
    },
  };
}

// Never throws. Resolves to { status: 'ok'|'not_found'|'error', ... }.
export async function fetchLeetCode(username, options = {}) {
  const res = await requestJson(ENDPOINT, {
    method: 'POST',
    body: { query: QUERY, variables: { username } },
    ...options,
  });
  if (!res.ok) return { status: 'error', error: res.error, retryable: res.retryable };
  return parseLeetCode(res.data);
}
