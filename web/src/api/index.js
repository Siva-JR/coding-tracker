// The only module the UI imports for data.
//
// Live vs sample: when VITE_API_URL is set, everything the backend already serves goes to it (login,
// departments, leaderboard, all admin endpoints). The rest (dashboard stats, activity, student detail,
// attention lists) still comes from the in-memory sample roster and is flagged "Sample data" in the UI.
// (Today every endpoint group is live, so no badge shows against the real backend.)
// With VITE_API_URL empty, everything runs on the sample roster so the app works offline.
import * as mock from './mock.js';
import * as live from './live.js';
import * as http from './http.js';

export const ApiError = mock.ApiError;
export const isLiveMode = http.isLiveConfigured;
export const DEMO_PASSWORD = mock.DEMO_PASSWORD;

// One flag per endpoint group; a false flag falls back to the sample roster and shows a "Sample data" badge.
const LIVE = {
  auth: isLiveMode,
  departments: isLiveMode,
  leaderboard: isLiveMode,
  github: isLiveMode,
  admin: isLiveMode,
  stats: isLiveMode,
  activity: isLiveMode,
  attention: isLiveMode,
  departmentOverview: isLiveMode,
  student: isLiveMode,
};
export const isSample = (feature) => isLiveMode && !LIVE[feature];
export const has = (feature) => !isLiveMode || !!LIVE[feature];

export const onUnauthenticated = (fn) => http.setUnauthenticatedHandler(fn);

let currentUser = null;
export const setCurrentUser = (u) => { currentUser = u; };
const u = () => {
  if (!currentUser) throw new ApiError(401, 'UNAUTHENTICATED', 'Login required');
  return currentUser;
};

// The mock has no cookie, so it remembers who is signed in.
const KEY = 'ct_mock_session';
const mockSession = {
  get: () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set: (id) => { try { id ? localStorage.setItem(KEY, JSON.stringify({ id })) : localStorage.removeItem(KEY); } catch { /* ignore */ } },
};

export const api = {
  auth: {
    login: async (username, password) => {
      if (LIVE.auth) return live.auth.login(username, password);
      const user = await mock.login(username, password);
      mockSession.set(user.id);
      return user;
    },
    me: async () => {
      if (LIVE.auth) return live.auth.me();
      const s = mockSession.get();
      if (!s?.id) throw new ApiError(401, 'UNAUTHENTICATED', 'Login required');
      return mock.me(s.id);
    },
    logout: async () => {
      if (LIVE.auth) { try { await live.auth.logout(); } catch { /* cookie may already be gone */ } return; }
      mockSession.set(null);
    },
    changePassword: async (current, next) => {
      if (LIVE.auth) { await live.auth.changePassword(current, next); return live.auth.me(); }
      return mock.changePassword(u(), current, next);
    },
  },
  departments: () => (LIVE.departments ? live.departments() : mock.departments(u())),
  leaderboard: (q) => (LIVE.leaderboard ? live.leaderboard(q) : mock.leaderboard(u(), q)),
  github: (q) => (LIVE.github ? live.github(q) : mock.github(u(), q)),

  departmentOverview: () => (LIVE.departmentOverview ? live.departmentOverview() : mock.departmentOverview(u())),
  stats: (q) => (LIVE.stats ? live.stats(q) : mock.stats(u(), q)),
  activity: (q) => (LIVE.activity ? live.activity(q) : mock.activity(u(), q)),
  student: (id) => (LIVE.student ? live.student(id) : mock.student(u(), id)),
  refreshTargets: (q) => (isLiveMode ? live.refreshTargets(q) : mock.refreshTargets(u(), q)),
  refreshMine: (id) => (isLiveMode ? live.refreshMine(id) : mock.refreshMine(u(), id)),
  attention: (q) => (LIVE.attention ? live.attention(q) : mock.attention(u(), q)),

  admin: LIVE.admin ? live.admin : {
    users: () => mock.listUsers(u()),
    createUser: (b) => mock.createUser(u(), b),
    updateUser: (id, b) => mock.updateUser(u(), id, b),
    resetPassword: (id, pw) => mock.resetPassword(u(), id, pw),
    createDepartment: (name, code) => mock.createDepartment(u(), name, code),
    updateDepartment: (id, b) => mock.updateDepartment(u(), id, b),
    students: (q) => mock.adminStudents(u(), q),
    addStudent: (row) => mock.addStudent(u(), row),
    updateStudent: (id, p) => mock.updateStudent(u(), id, p),
    deleteStudent: (id) => mock.deleteStudent(u(), id),
    refreshStudent: (id) => mock.refreshStudent(u(), id),
    validate: (rows) => mock.validateRows(u(), rows),
    importRows: (rows) => mock.importRows(u(), rows),
  },
};
