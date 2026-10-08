// The real backend, one function per endpoint in BACKEND_PLAN §3.
import { get, post, patch, del } from './http.js';

export const auth = {
  login: (username, password) => post('/api/auth/login', { username, password }, { quiet401: true }).then((r) => r.user),
  me: () => get('/api/auth/me', undefined, { quiet401: true }).then((r) => r.user),
  logout: () => post('/api/auth/logout', {}, { quiet401: true }),
  changePassword: (currentPassword, newPassword) => post('/api/auth/change-password', { currentPassword, newPassword }),
};

export const departments = () => get('/api/departments');

export const github = (q) => get('/api/github', { deptId: q.deptId, year: q.year, q: q.q, limit: q.limit, offset: q.offset });

export const leaderboard = (q) => get('/api/leaderboard', {
  platform: q.platform, sort: q.sort, year: q.year, deptId: q.deptId, limit: q.limit, q: q.q,
}).then((data) => ({
  ...data,
  count: data.total ?? data.entries.length,
}));

export const stats = (q) => get('/api/stats', { deptId: q?.deptId });
export const activity = (q) => get('/api/activity', { deptId: q?.deptId, limit: q?.limit });
export const attention = (q) => get('/api/attention', { deptId: q?.deptId });
export const departmentOverview = () => get('/api/departments/overview');
export const refreshTargets = (q) => get('/api/refresh', { deptId: q?.deptId });
export const refreshMine = (id) => post(`/api/refresh/students/${id}`, {}, { timeout: 45000 });
export const student = (id) => get(`/api/students/${id}`);

export const admin = {
  users: () => get('/api/admin/users'),
  createUser: (body) => post('/api/admin/users', body),
  updateUser: (id, body) => patch(`/api/admin/users/${id}`, body),
  resetPassword: (id, password) => post(`/api/admin/users/${id}/reset-password`, password ? { password } : {}),
  createDepartment: (name, code) => post('/api/admin/departments', { name, code }),

  students: (q) => get('/api/admin/students', q),
  addStudent: (row) => post('/api/admin/students', row, { timeout: 45000 }),
  updateStudent: (id, patchBody) => patch(`/api/admin/students/${id}`, patchBody, { timeout: 45000 }),
  deleteStudent: (id) => del(`/api/admin/students/${id}`),
  refreshStudent: (id) => post(`/api/admin/students/${id}/refresh`, {}, { timeout: 45000 }),
  validate: (rows) => post('/api/admin/students/validate', { rows }, { timeout: 60000 }),
  importRows: (rows) => post('/api/admin/students/import', { rows }, { timeout: 60000 }),
};
