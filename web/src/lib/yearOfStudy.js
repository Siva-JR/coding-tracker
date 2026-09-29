// Single implementation of "year of study" (same rule as the backend plan §3).
// The academic year starts in June.
export function endYearFor(date = new Date()) {
  return date.getMonth() + 1 >= 6 ? date.getFullYear() + 1 : date.getFullYear();
}

export function yearOfStudy(batchYear, date = new Date()) {
  return 4 - (batchYear - endYearFor(date));
}

export function batchYearFor(year, date = new Date()) {
  return endYearFor(date) + (4 - year);
}

const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
export const ordinalYear = (y) => (ORD[y] ? `${ORD[y]} year` : '—');
