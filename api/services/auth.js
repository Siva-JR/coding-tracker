import jwt from 'jsonwebtoken';
import { HttpError } from '../http.js';
import { hashPassword, verifyPassword, passwordProblem, DUMMY_HASH } from './passwords.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const SESSION_MS = 8 * 60 * 60 * 1000;

const invalidCredentials = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');

export async function loadUser(db, id) {
  const { rows: [u] } = await db.query(
    'select id, username, display_title, role, must_change_password, token_version, disabled from staff where id = $1',
    [id],
  );
  if (!u) return null;

  const { rows } = await db.query(
    `select ss.dept_id, d.code, d.name, ss.year
     from staff_scopes ss left join departments d on d.id = ss.dept_id
     where ss.staff_id = $1
     order by d.code nulls first, ss.year nulls first`,
    [id],
  );

  return {
    id: u.id,
    username: u.username,
    displayTitle: u.display_title,
    role: u.role,
    mustChangePassword: u.must_change_password,
    tokenVersion: u.token_version,
    disabled: u.disabled,
    scopes: u.role === 'admin' ? [] : rows.map((r) => ({ deptId: r.dept_id, deptCode: r.code, deptName: r.name, year: r.year })),
  };
}

export const publicUser = ({ tokenVersion, disabled, ...rest }) => rest;

export const signSession = (user, secret) =>
  jwt.sign({ sub: user.id, tv: user.tokenVersion }, secret, { algorithm: 'HS256', expiresIn: Math.floor(SESSION_MS / 1000) });

// A token is only valid while the account exists, is enabled, and its token_version is unchanged,
// so password resets and disabling take effect immediately.
export async function userFromToken(db, token, secret) {
  let payload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const user = await loadUser(db, payload.sub);
  if (!user || user.disabled || user.tokenVersion !== payload.tv) return null;
  return user;
}

export async function login(db, { username, password }, { now = new Date() } = {}) {
  const name = String(username ?? '').trim().toLowerCase();
  const attempt = typeof password === 'string' && password.length <= 200 ? password : '';

  const { rows: [row] } = await db.query('select id, password_hash, disabled, locked_until from staff where username = $1', [name]);
  if (!row) {
    await verifyPassword(attempt, DUMMY_HASH);
    throw invalidCredentials();
  }

  if (row.locked_until && row.locked_until > now) {
    const retryAfterSeconds = Math.ceil((row.locked_until.getTime() - now.getTime()) / 1000);
    throw new HttpError(423, 'LOCKED', 'Too many failed attempts. Try again later.', { retryAfterSeconds });
  }

  const passwordOk = await verifyPassword(attempt, row.password_hash);
  if (!passwordOk) {
    await db.query(
      `update staff set
         failed_attempts = case when failed_attempts + 1 >= $2 then 0 else failed_attempts + 1 end,
         locked_until = case when failed_attempts + 1 >= $2 then $3::timestamptz else locked_until end
       where id = $1`,
      [row.id, MAX_FAILED_ATTEMPTS, new Date(now.getTime() + LOCK_MS)],
    );
    throw invalidCredentials();
  }
  if (row.disabled) throw invalidCredentials();

  await db.query('update staff set failed_attempts = 0, locked_until = null where id = $1', [row.id]);
  return loadUser(db, row.id);
}

export async function changePassword(db, userId, currentPassword, newPassword) {
  const { rows: [row] } = await db.query('select username, password_hash from staff where id = $1', [userId]);
  if (!row || !(await verifyPassword(String(currentPassword ?? '').slice(0, 200), row.password_hash))) {
    throw new HttpError(400, 'WRONG_PASSWORD', 'Current password is incorrect');
  }
  const problem = passwordProblem(newPassword, row.username);
  if (problem) throw new HttpError(400, 'WEAK_PASSWORD', problem);
  if (newPassword === currentPassword) throw new HttpError(400, 'WEAK_PASSWORD', 'New password must be different from the current one');

  await db.query(
    'update staff set password_hash = $2, must_change_password = false, token_version = token_version + 1 where id = $1',
    [userId, await hashPassword(newPassword)],
  );
  return loadUser(db, userId);
}
