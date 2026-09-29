const IST_OFFSET_MS = 330 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Scrape windows in IST hours: 00:00-03:00 and 18:00-21:00.
const WINDOWS = [
  { startHour: 0, endHour: 3 },
  { startHour: 18, endHour: 21 },
];

function istMidnightUtcMs(now) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
}

export function currentWindow(now) {
  const midnight = istMidnightUtcMs(now);
  for (const { startHour, endHour } of WINDOWS) {
    const start = midnight + startHour * HOUR_MS;
    const end = midnight + endHour * HOUR_MS;
    if (now.getTime() >= start && now.getTime() < end) return { start: new Date(start), end: new Date(end) };
  }
  return null;
}

// Calendar date in IST as YYYY-MM-DD; used as the snapshot day.
export function istDate(now) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
