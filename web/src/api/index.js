// The only module the UI imports for data.
//
// Live vs sample: when VITE_API_URL is set, everything the backend already serves goes to it (login,
// departments, leaderboard, all admin endpoints). The rest (dashboard stats, activity, student detail,
// attention lists) still comes from the in-memory sample roster and is flagged "Sample data" in the UI.
// With VITE_API_URL empty, everything runs on the sample roster so the app works offline.
import * as mock from './mock.js';
import * as live from './live.js';
import * as http from './http.js';

export const ApiError = mock.ApiError;
export const isLiveMode = http.isLiveConfigured;
export const DEMO_PASSWORD = mock.DEMO_PASSWORD;

// Flip a flag to true as each endpoint ships on the backend.
const LIVE = {
  auth: isLiveMode,
  departments: isLiveMode,
  leaderboard: isLiveMode,
  admin: isLiveMode,
  // not built yet: stats, activity, departmentOverview, student, attention
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

  // sample-only for now
  departmentOverview: () => mock.departmentOverview(u()),
  stats: (q) => mock.stats(u(), q),
  activity: (q) => mock.activity(u(), q),
  student: (id) => mock.student(u(), id),
  attention: (q) => mock.attention(u(), q),

  admin: LIVE.admin ? live.admin : {
    users: () => mock.listUsers(u()),
    createUser: (b) => mock.createUser(u(), b),
    updateUser: (id, b) => mock.updateUser(u(), id, b),
    resetPassword: (id, pw) => mock.resetPassword(u(), id, pw),
    createDepartment: (name, code) => mock.createDepartment(u(), name, code),
    students: (q) => mock.adminStudents(u(), q),
    addStudent: (row) => mock.addStudent(u(), row),
    updateStudent: (id, p) => mock.updateStudent(u(), id, p),
    deleteStudent: (id) => mock.deleteStudent(u(), id),
    refreshStudent: (id) => mock.refreshStudent(u(), id),
    validate: (rows) => mock.validateRows(u(), rows),
    importRows: (rows) => mock.importRows(u(), rows),
  },
};
