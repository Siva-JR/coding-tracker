// Transport for the real backend (github.com/Siva-JR/coding-tracker).
// Follows the AppSail constraints we agreed on: GET requests with no custom
// headers (so the browser never sends a CORS preflight), POST bodies as
// text/plain, and the session token in the query string.
export const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const isLiveConfigured = BASE !== '';

let token = null;
export const setToken = (t) => { token = t || null; };
const withToken = (qs) => (token ? { ...qs, token } : qs);

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function toQuery(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function parse(res) {
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page from the gateway */ }
  if (!res.ok) {
    const e = body?.error;
    throw new HttpError(res.status, e?.code || 'HTTP_ERROR', e?.message || `Server returned ${res.status}`);
  }
  return body;
}

async function send(url, init, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await parse(await fetch(url, { ...init, signal: ctrl.signal }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.name === 'AbortError') throw new HttpError(408, 'TIMEOUT', 'The server took too long to answer.');
    throw new HttpError(0, 'NETWORK', 'Could not reach the server.');
  } finally {
    clearTimeout(t);
  }
}

export const get = (path, query = {}) => send(`${BASE}${path}${toQuery(withToken(query))}`);

/** JSON as text/plain keeps this a "simple" request (no preflight). */
export const post = (path, body = {}, query = {}) =>
  send(`${BASE}${path}${toQuery(withToken(query))}`, { method: 'POST', body: JSON.stringify(body) });
