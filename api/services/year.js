// Academic year starts in June. Assumes 4-year programmes.
export function academicEndYear(now = new Date()) {
  const month = now.getUTCMonth() + 1;
  return month >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

export function yearOfStudy(batchYear, now = new Date()) {
  return 4 - (batchYear - academicEndYear(now));
}

export function batchYearFor(year, now = new Date()) {
  return academicEndYear(now) + 4 - year;
}
