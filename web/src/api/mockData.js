// Deterministic fake roster that follows the API contract's shapes.
// Replaced by the real backend later; nothing outside src/api should import this.
import { batchYearFor, yearOfStudy } from '../lib/yearOfStudy.js';
import { isoDate } from '../lib/format.js';

export const HISTORY_DAYS = 120;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEPARTMENTS = [
  // ids 1-3 match the teammate's seed script (CSE, IT, ECE) so live and sample data agree.
  { id: 1, code: 'CSE', name: 'Computer Science & Engineering', size: 75, skill: 1.25 },
  { id: 2, code: 'IT', name: 'Information Technology', size: 48, skill: 1.15 },
  { id: 3, code: 'ECE', name: 'Electronics & Communication', size: 55, skill: 0.8 },
  { id: 4, code: 'AIDS', name: 'AI & Data Science', size: 50, skill: 1.2 },
  { id: 5, code: 'AIML', name: 'AI & Machine Learning', size: 40, skill: 1.15 },
  { id: 6, code: 'CSBS', name: 'Computer Science & Business Systems', size: 30, skill: 1.0 },
  { id: 7, code: 'EEE', name: 'Electrical & Electronics', size: 35, skill: 0.6 },
  { id: 8, code: 'MECH', name: 'Mechanical Engineering', size: 40, skill: 0.4 },
  { id: 9, code: 'CIVIL', name: 'Civil Engineering', size: 30, skill: 0.35 },
  { id: 10, code: 'BME', name: 'Biomedical Engineering', size: 25, skill: 0.5 },
];

const FIRST = ['Arun', 'Priya', 'Karthik', 'Divya', 'Rahul', 'Sneha', 'Vikram', 'Ananya', 'Surya', 'Meera', 'Naveen', 'Kavya', 'Harish', 'Lakshmi', 'Dinesh', 'Pooja', 'Gokul', 'Nithya', 'Manoj', 'Swetha', 'Bharath', 'Deepika', 'Sanjay', 'Harini', 'Ajay', 'Ishwarya', 'Vignesh', 'Janani', 'Tarun', 'Revathi', 'Praveen', 'Sowmya', 'Yuvan', 'Aishwarya', 'Kishore', 'Bhavana'];
const LAST = ['Kumar', 'S', 'R', 'M', 'K', 'V', 'P', 'N', 'G', 'D', 'T', 'B', 'A', 'L', 'J'];
const LAST_LONG = { Kumar: 'kumar' };

const TODAY = new Date();
export const TODAY_ISO = isoDate(TODAY);

export function dayIso(offsetFromToday) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - offsetFromToday);
  return isoDate(d);
}

function buildHistory(r, final, activeP, meanPerDay, dormant) {
  // Walk backwards from today's total so the series always lands on `final`.
  const out = new Array(HISTORY_DAYS);
  let total = final;
  out[HISTORY_DAYS - 1] = total;
  for (let i = HISTORY_DAYS - 1; i > 0; i--) {
    const daysAgo = HISTORY_DAYS - 1 - i;
    let gain = 0;
    const active = dormant && daysAgo < 21 ? 0 : r() < activeP ? 1 : 0;
    if (active) gain = 1 + Math.floor(r() * r() * meanPerDay * 3);
    total = Math.max(0, total - gain);
    out[i - 1] = total;
  }
  return out;
}

function rankFor(total, r) {
  if (total <= 0) return null;
  const base = 4_800_000 / Math.pow(total + 8, 1.25);
  return Math.round(base * (0.7 + r() * 0.6)) + 1200;
}

export function generateStudents() {
  const r = rng(20260929);
  const students = [];
  let id = 1;
  for (const dept of DEPARTMENTS) {
    for (let n = 0; n < dept.size; n++) {
      const yr = (() => {
        const x = r();
        return x < 0.3 ? 1 : x < 0.58 ? 2 : x < 0.86 ? 3 : 4;
      })();
      const batchYear = batchYearFor(yr);
      const first = FIRST[Math.floor(r() * FIRST.length)];
      const last = LAST[Math.floor(r() * LAST.length)];
      const name = `${first} ${last}`;
      const joinedYY = String(batchYear - 4).slice(2);
      const rollNo = `${joinedYY}${dept.code}${String(n + 1).padStart(3, '0')}`;
      const yearFactor = [0, 0.45, 0.8, 1.1, 1.3][yr];
      const ability = Math.pow(r(), 1.6) * 1.6 + 0.08;
      const lcFinal = Math.round(ability * dept.skill * yearFactor * 260);
      const hrFinal = Math.round(ability * dept.skill * yearFactor * 90 * (0.5 + r()));
      const activeP = 0.08 + r() * 0.5;
      const dormant = r() < 0.12;
      const lcUser = `${first.toLowerCase()}${(LAST_LONG[last] || last.toLowerCase())}${Math.floor(r() * 900 + 100)}`;
      const hrUser = `${first.toLowerCase()}_${last.toLowerCase()}${Math.floor(r() * 90 + 10)}`;

      // Fetch health. Most are fine; a few profiles are broken or stale.
      const roll = r();
      const lcStatus = roll < 0.03 ? 'not_found' : roll < 0.05 ? 'error' : 'ok';
      const roll2 = r();
      const hrStatus = roll2 < 0.04 ? 'not_found' : roll2 < 0.055 ? 'error' : 'ok';
      const stale = r() < 0.03;

      const lcHist = lcStatus === 'not_found' ? null : buildHistory(r, lcFinal, activeP, 2.2, dormant);
      const hrHist = hrStatus === 'not_found' ? null : buildHistory(r, hrFinal, activeP * 0.8, 1.4, dormant);

      const hardShare = Math.min(0.18, 0.02 + ability * 0.06);
      const medShare = Math.min(0.5, 0.2 + ability * 0.12);
      const hard = Math.round(lcFinal * hardShare);
      const medium = Math.round(lcFinal * medShare);
      const easy = Math.max(0, lcFinal - hard - medium);

      students.push({
        id: id++,
        rollNo,
        name,
        deptId: dept.id,
        deptCode: dept.code,
        batchYear,
        leetcodeUsername: lcUser,
        hackerrankUsername: hrUser,
        githubUrl: [...lcUser].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 10 < 7 ? `https://github.com/${lcUser}` : null,
        leetcode: {
          status: lcStatus,
          history: lcHist,
          easy,
          medium,
          hard,
          globalRank: lcHist && lcFinal > 0 && r() > 0.05 ? rankFor(lcFinal, r) : null,
          lastError:
            lcStatus === 'not_found' ? 'Profile not found (404)' : lcStatus === 'error' ? 'HTTP 429 from LeetCode after 2 retries' : null,
          lastOk: lcHist ? (stale || lcStatus === 'error' ? dayIso(4 + Math.floor(r() * 5)) : TODAY_ISO) : null,
        },
        hackerrank: {
          status: hrStatus,
          history: hrHist,
          stars: hrHist ? Math.min(5, Math.floor(hrFinal / 40) + (hrFinal > 0 ? 1 : 0)) : null,
          lastError:
            hrStatus === 'not_found' ? 'Profile not found (404)' : hrStatus === 'error' ? 'Request timed out after 10s' : null,
          lastOk: hrHist ? (hrStatus === 'error' ? dayIso(3 + Math.floor(r() * 5)) : TODAY_ISO) : null,
        },
      });
    }
  }
  return students;
}

const scopeFor = (deptId, year = null) => {
  const d = deptId ? DEPARTMENTS.find((x) => x.id === deptId) : null;
  return { deptId: d ? d.id : null, deptCode: d ? d.code : null, deptName: d ? d.name : null, year };
};

export const DEMO_PASSWORD = 'demo12345';

// Same shape as the backend's user object (BACKEND_PLAN §3): role admin | viewer, plus scopes.
export const USERS = [
  { id: 1, username: 'admin', role: 'admin', displayTitle: 'Administrator', scopes: [] },
  { id: 2, username: 'principal', role: 'viewer', displayTitle: 'Principal', scopes: [scopeFor(null)] },
  { id: 3, username: 'vice.chairman', role: 'viewer', displayTitle: 'Vice Chairman', scopes: [scopeFor(null)] },
  ...DEPARTMENTS.map((d, i) => ({
    id: 4 + i, username: `hod.${d.code.toLowerCase()}`, role: 'viewer', displayTitle: `HoD - ${d.code}`, scopes: [scopeFor(d.id)],
  })),
  { id: 14, username: 'coord.cse2', role: 'viewer', displayTitle: 'CSE 2nd-year coordinator', scopes: [scopeFor(1, 2)] },
].map((u) => ({ ...u, password: DEMO_PASSWORD, mustChangePassword: false, disabled: false }));

export const scopeOf = scopeFor;

export const yearOf = (s) => yearOfStudy(s.batchYear);
