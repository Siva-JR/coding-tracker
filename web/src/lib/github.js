// GitHub links are only stored for now (no fetching). This mirrors the server's format check so the
// forms can point out a typo before submitting.
export function checkGithubUrl(raw) {
  const text = (raw || '').trim();
  if (!text) return null; // optional
  let url;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return 'Not a valid link'; }
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return 'Expected a github.com link, for example https://github.com/username';
  if (!url.pathname.split('/').filter(Boolean).length) return 'The link has no username, for example https://github.com/username';
  return null;
}

/** "github.com/username" for display, or null when the value isn't a usable link. */
export function githubHandle(raw) {
  const text = (raw || '').trim();
  if (!text || checkGithubUrl(text)) return null;
  const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  return `github.com/${url.pathname.split('/').filter(Boolean)[0]}`;
}
