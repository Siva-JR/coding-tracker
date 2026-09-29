import { createApp } from '../../api/app.js';
import { hashPassword } from '../../api/services/passwords.js';

export const SESSION_SECRET = 'x'.repeat(40);
export const SCRAPE_SECRET = 'test-scrape-secret';
export const DEFAULT_PASSWORD = 'Password123';

// September 2026: outside any scrape window; year 3 == batch 2028.
export const NOW = new Date('2026-09-30T06:00:00Z');

export async function startTestApp(db, overrides = {}) {
  const clock = { now: NOW };
  const app = createApp({
    db,
    sessionSecret: SESSION_SECRET,
    scrapeSecret: SCRAPE_SECRET,
    now: () => clock.now,
    log: () => {},
    tickOptions: { sleep: async () => {} },
    ...overrides,
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    clock,
    client: () => new Client(base),
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Minimal HTTP client with a cookie jar.
export class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  async request(method, path, body, { headers = {}, json = true } = {}) {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.base + path, {
      method,
      headers: {
        ...(method !== 'GET' && json ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: method === 'GET' ? undefined : (json ? JSON.stringify(body ?? {}) : body),
    });

    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }

    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get(path) { return this.request('GET', path); }
  post(path, body, options) { return this.request('POST', path, body, options); }
  patch(path, body) { return this.request('PATCH', path, body); }
  delete(path) { return this.request('DELETE', path); }

  async login(username, password = DEFAULT_PASSWORD) {
    const res = await this.post('/api/auth/login', { username, password });
    if (res.status !== 200) throw new Error(`login as ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res;
  }
}

// Inserts a staff account directly. scopes: [{ deptId, year }].
export async function createStaff(db, { username, password = DEFAULT_PASSWORD, role = 'viewer', scopes = [], mustChange = false, title = null, disabled = false }) {
  const { rows: [row] } = await db.query(
    'insert into staff (username, password_hash, role, display_title, must_change_password, disabled) values ($1, $2, $3, $4, $5, $6) returning id',
    [username, await hashPassword(password), role, title, mustChange, disabled],
  );
  for (const s of scopes) {
    await db.query('insert into staff_scopes (staff_id, dept_id, year) values ($1, $2, $3)', [row.id, s.deptId ?? null, s.year ?? null]);
  }
  return row.id;
}
