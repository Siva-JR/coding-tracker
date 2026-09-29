// The only module the UI imports for data.
//
// Live vs sample: when VITE_API_URL is set, every endpoint the teammate's
// backend already serves goes to it; the rest still come from the in-memory
// sample roster (mock.js) and are flagged as such in the UI via `isSample()`.
import * as mock from './mock.js';
import * as http from './http.js';

export const ApiError = mock.ApiError;

// Endpoints that exist on the backend today. Flip a flag as each one ships.
const LIVE = {
  leaderboard: http.isLiveConfigured,
  // auth, departments, stats, activity, students, student, attention, admin: not built yet
};

export const isLiveMode = http.isLiveConfigured;
export const isSample = (feature) => isLiveMode && !LIVE[feature];
export const has = (feature) => !isLiveMode || !!LIVE[feature];

let currentUser = null;
export const setCurrentUser = (u) => { currentUser = u; };
const u = () => {
  if (!currentUser) throw new mock.ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
  return currentUser;
};

// Backend uses its own error class; the UI only relies on `.status` and `.message`.
async function liveLeaderboard(q = {}) {
  const user = u();
  const deptId = user.role === 'hod' ? user.deptId : q.deptId; // scope stays server-derived once auth exists
  const data = await http.get('/api/leaderboard', {
    platform: q.platform,
    sort: q.sort,
    year: q.year,
    deptId,
    limit: q.limit,
  });
  return {
    ...data,
    count: data.entries.length,
    entries: data.entries.map((e) => ({ weekGain: null, stale: false, ...e })),
  };
}

export const api = {
  login: (username, password) => mock.login(username, password),
  me: (id) => mock.me(id),
  departments: () => mock.departments(u()),
  departmentOverview: () => mock.departmentOverview(u()),
  leaderboard: (q) => (LIVE.leaderboard ? liveLeaderboard(q) : mock.leaderboard(u(), q)),
  stats: (q) => mock.stats(u(), q),
  activity: (q) => mock.activity(u(), q),
  students: (q) => mock.listStudents(u(), q),
  student: (id) => mock.student(u(), id),
  attention: (q) => mock.attention(u(), q),
  admin: {
    validate: (rows) => mock.validateRows(u(), rows),
    addStudent: (row) => mock.addStudent(u(), row),
    importRows: (items) => mock.importRows(u(), items),
    updateStudent: (id, patch) => mock.updateStudent(u(), id, patch),
    deleteStudent: (id) => mock.deleteStudent(u(), id),
    staff: () => mock.listStaff(u()),
    createStaff: (body) => mock.createStaff(u(), body),
    setStaffDisabled: (id, d) => mock.setStaffDisabled(u(), id, d),
    resetPassword: (id) => mock.resetPassword(u(), id),
  },
};
