import { batchYearFor } from './year.js';

// Turns a user's scope rows into concrete (department, batch year) grants.
// Admins and anyone with an all-departments, all-years scope are unrestricted.
export function resolveAccess(user, now = new Date()) {
  if (user.role === 'admin') return { unrestricted: true, grants: null };

  const grants = user.scopes.map((s) => ({
    deptId: s.deptId ?? null,
    batchYear: s.year == null ? null : batchYearFor(s.year, now),
  }));
  if (grants.some((g) => g.deptId === null && g.batchYear === null)) return { unrestricted: true, grants: null };
  return { unrestricted: false, grants };
}

// A request for a specific department and/or year is allowed only if a single grant covers it.
// Requests that name neither are allowed but the query is still filtered to the grants.
export function canRequest(access, { deptId = null, year = null }, now = new Date()) {
  if (access.unrestricted) return true;
  const batchYear = year === null || year === 'all' ? null : batchYearFor(year, now);
  return access.grants.some(
    (g) => (deptId === null || g.deptId === null || g.deptId === deptId)
      && (batchYear === null || g.batchYear === null || g.batchYear === batchYear),
  );
}

// Bound to a jsonb query parameter; null means "no restriction".
export function grantsParam(access) {
  if (access.unrestricted) return null;
  return JSON.stringify(access.grants.map((g) => ({ dept_id: g.deptId, batch_year: g.batchYear })));
}

export function canSeeDepartment(access, deptId) {
  return access.unrestricted || access.grants.some((g) => g.deptId === null || g.deptId === deptId);
}
