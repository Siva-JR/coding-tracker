// The GitHub link is only stored for now: no fetching, no username extraction.
// We check the link is a github.com address so that typos and placeholder text are caught early.
const MAX_LENGTH = 300;

// Returns { ok: true, url } (cleaned, or null when empty) or { ok: false, error }.
export function parseGithubUrl(raw) {
  if (raw === undefined || raw === null) return { ok: true, url: null };
  if (typeof raw !== 'string') return { ok: false, error: 'github: must be a link' };
  let text = raw.trim();
  if (!text) return { ok: true, url: null };
  if (text.length > MAX_LENGTH) return { ok: false, error: `github: link must be at most ${MAX_LENGTH} characters` };
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'github: not a valid link' };
  }
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
    return { ok: false, error: 'github: expected a github.com link, for example https://github.com/username' };
  }
  if (!url.pathname.split('/').filter(Boolean).length) {
    return { ok: false, error: 'github: the link has no username, for example https://github.com/username' };
  }
  return { ok: true, url: text };
}
