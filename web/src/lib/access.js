// What a signed-in user may see, derived from their scopes.
// The server enforces this; the UI only uses it to avoid offering things that would be refused.
//
//   deptIds: null = every department, otherwise the department ids covered by any scope
//   years:   null = every year of study, otherwise the years (only when *every* scope names a year)
import { yearLabel } from './yearOfStudy.js';

export function accessOf(user) {
  if (!user || user.role === 'admin') return { deptIds: null, years: null };
  const scopes = user.scopes || [];
  if (scopes.some((s) => s.deptId == null && s.year == null)) return { deptIds: null, years: null };
  return {
    deptIds: scopes.some((s) => s.deptId == null) ? null : [...new Set(scopes.map((s) => s.deptId))],
    years: scopes.length && scopes.every((s) => s.year != null) ? [...new Set(scopes.map((s) => s.year))].sort() : null,
  };
}

/** Does any single scope cover this student? Mirrors the server rule. */
export function scopeCovers(user, { deptId, yearOfStudy }) {
  if (user.role === 'admin') return true;
  return (user.scopes || []).some((s) => (s.deptId == null || s.deptId === deptId) && (s.year == null || s.year === yearOfStudy));
}

export function describeScopes(user) {
  if (user.role === 'admin') return 'Full access, can manage data';
  const parts = (user.scopes || []).map((s) => `${s.deptCode || 'All departments'} · ${s.year ? yearLabel(s.year) : 'All Years'}`);
  return parts.length ? parts.join(', ') : 'No access granted';
}
