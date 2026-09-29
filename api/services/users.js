import { withTransaction } from '../db.js';
import { HttpError, bad } from '../http.js';
import { hashPassword, generatePassword, passwordProblem } from './passwords.js';
import { loadUser } from './auth.js';

// Admin view of a user: like the login response, but includes whether the account is disabled.
const adminView = ({ tokenVersion, ...rest }) => rest;

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

function normalizeScopes(role, scopes) {
  if (role === 'admin') {
    if (scopes?.length) throw bad('Admins see everything and cannot have scopes');
    return [];
  }
  if (!scopes?.length) throw bad('Viewers need at least one scope');
  const seen = new Set();
  const result = [];
  for (const s of scopes) {
    const scope = { deptId: s.deptId ?? null, year: s.year ?? null };
    const key = `${scope.deptId ?? 0}:${scope.year ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(scope);
  }
  return result;
}

async function writeScopes(client, staffId, scopes) {
  await client.query('delete from staff_scopes where staff_id = $1', [staffId]);
  for (const s of scopes) {
    try {
      await client.query('insert into staff_scopes (staff_id, dept_id, year) values ($1, $2, $3)', [staffId, s.deptId, s.year]);
    } catch (err) {
      if (err.code === '23503') throw bad(`Unknown department id ${s.deptId}`);
      throw err;
    }
  }
}

export async function listUsers(db) {
  const { rows } = await db.query('select id from staff order by username');
  return Promise.all(rows.map(async (r) => adminView(await loadUser(db, r.id))));
}

export async function createUser(db, { username, displayTitle, role, password, scopes }) {
  const name = String(username).trim().toLowerCase();
  if (!USERNAME_RE.test(name)) throw bad('username must be 3-32 characters: letters, digits, dot, dash or underscore');

  const generated = !password;
  const plain = generated ? generatePassword() : password;
  const problem = passwordProblem(plain, name);
  if (problem) throw bad(problem);
  const finalScopes = normalizeScopes(role, scopes);
  const passwordHash = await hashPassword(plain);

  const id = await withTransaction(db, async (client) => {
    let row;
    try {
      row = (await client.query(
        'insert into staff (username, password_hash, role, display_title, must_change_password) values ($1, $2, $3, $4, true) returning id',
        [name, passwordHash, role, displayTitle?.trim() || null],
      )).rows[0];
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'USERNAME_TAKEN', `Username ${name} is already taken`);
      throw err;
    }
    await writeScopes(client, row.id, finalScopes);
    return row.id;
  });

  return { user: adminView(await loadUser(db, id)), temporaryPassword: generated ? plain : undefined };
}

export async function updateUser(db, id, { displayTitle, role, scopes, disabled }) {
  await withTransaction(db, async (client) => {
    const activeAdmins = (await client.query("select id from staff where role = 'admin' and not disabled for update")).rows.map((r) => r.id);
    const current = (await client.query('select id, role, disabled from staff where id = $1 for update', [id])).rows[0];
    if (!current) throw new HttpError(404, 'NOT_FOUND', 'User not found');

    const newRole = role ?? current.role;
    const newDisabled = disabled ?? current.disabled;

    const wasActiveAdmin = activeAdmins.includes(id);
    if (wasActiveAdmin && (newRole !== 'admin' || newDisabled) && !activeAdmins.some((a) => a !== id)) {
      throw new HttpError(409, 'LAST_ADMIN', 'At least one active admin must remain');
    }

    let finalScopes = null;
    if (scopes !== undefined) finalScopes = normalizeScopes(newRole, scopes);
    else if (newRole !== current.role) finalScopes = normalizeScopes(newRole, newRole === 'admin' ? [] : undefined);

    const revoke = newRole !== current.role || newDisabled !== current.disabled;
    await client.query(
      `update staff set
         display_title = case when $2::boolean then $3 else display_title end,
         role = $4, disabled = $5,
         token_version = token_version + case when $6::boolean then 1 else 0 end
       where id = $1`,
      [id, displayTitle !== undefined, displayTitle?.trim() || null, newRole, newDisabled, revoke],
    );
    if (finalScopes) await writeScopes(client, id, finalScopes);
  });
  return adminView(await loadUser(db, id));
}

export async function resetPassword(db, id, password) {
  const generated = !password;
  const plain = generated ? generatePassword() : password;
  const { rows: [target] } = await db.query('select username from staff where id = $1', [id]);
  if (!target) throw new HttpError(404, 'NOT_FOUND', 'User not found');
  const problem = passwordProblem(plain, target.username);
  if (problem) throw bad(problem);

  await db.query(
    `update staff set password_hash = $2, must_change_password = true, token_version = token_version + 1,
       failed_attempts = 0, locked_until = null
     where id = $1`,
    [id, await hashPassword(plain)],
  );
  return { temporaryPassword: generated ? plain : undefined };
}
