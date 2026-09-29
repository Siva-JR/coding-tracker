// Transport for the real backend (Siva-JR/coding-tracker).
// Matches its contract: httpOnly session cookie (so credentials: 'include'), and every
// non-GET request sends Content-Type: application/json (the backend's CSRF guard).
export const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const isLiveConfigured = BASE !== '';

export class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthenticated = () => {};
export const setUnauthenticatedHandler = (fn) => { onUnauthenticated = fn; };

function toQuery(obj = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, { query, body, timeout = 30000, quiet401 = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}${toQuery(query)}`, {
      method,
      credentials: 'include',
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* gateway error pages are not JSON */ }
    if (!res.ok) {
      const e = data?.error || {};
      const { code, message, ...details } = e;
      if (res.status === 401 && !quiet401 && code === 'UNAUTHENTICATED') onUnauthenticated();
      throw new HttpError(res.status, code || 'HTTP_ERROR', message || `Server returned ${res.status}`, details);
    }
    return data;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.name === 'AbortError') throw new HttpError(408, 'TIMEOUT', 'The server took too long to answer.');
    throw new HttpError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(t);
  }
}

export const get = (path, query, opts) => request('GET', path, { query, ...opts });
export const post = (path, body, opts) => request('POST', path, { body, ...opts });
export const patch = (path, body, opts) => request('PATCH', path, { body, ...opts });
export const del = (path, opts) => request('DELETE', path, opts);
