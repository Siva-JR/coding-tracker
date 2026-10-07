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

const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
/** "III" for use in narrow table columns */
export const romanYear = (y) => ROMAN[y] ?? '—';
/** "III Year" */
export const yearLabel = (y) => (ROMAN[y] ? `${ROMAN[y]} Year` : '—');
/** "III Year (2028)": the year of study with the batch it belongs to right now */
export const yearBatchLabel = (y, date = new Date()) => (ROMAN[y] ? `${yearLabel(y)} (${batchYearFor(y, date)})` : '—');
