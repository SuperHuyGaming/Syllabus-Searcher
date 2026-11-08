// Same rules as the API (api/src/lib/terms.js). Codes carry their school: GMU's stay
// bare ("CS310", department "CS"), every other school's are prefixed ("unc:COMP110").
export const DEFAULT_SCHOOL = 'gmu';

// "cs 310", "CS-310", "cs310" -> "CS310"; at school "unc", "comp 110" -> "unc:COMP110".
// A typed prefix wins over the school given: "unc:COMP 110" -> "unc:COMP110".
export function normalizeCourse(input, school = DEFAULT_SCHOOL) {
  const match = String(input || '')
    .trim()
    .match(/^(?:([A-Za-z]{2,12})\s*:\s*)?([A-Za-z]{2,5})\s*-?\s*(\d{3,4}[A-Za-z]?)$/);
  if (!match) return null;
  const key = (match[1] || school || DEFAULT_SCHOOL).toLowerCase();
  const bare = `${match[2].toUpperCase()}${match[3].toUpperCase()}`;
  return key === DEFAULT_SCHOOL ? bare : `${key}:${bare}`;
}

// "unc:COMP110" -> "unc", "CS310" -> "gmu"
export function schoolOf(code) {
  const match = String(code).match(/^([a-z]+):/);
  return match ? match[1] : DEFAULT_SCHOOL;
}

// "unc:COMP110" -> "COMP110"
export function withoutSchool(code) {
  return String(code).replace(/^[a-z]+:/, '');
}

// "CS310" -> "CS 310", "unc:COMP110" -> "COMP 110"
export function displayCourse(code) {
  const bare = withoutSchool(code);
  const match = bare.match(/^([A-Z]+)(\d.*)$/);
  return match ? `${match[1]} ${match[2]}` : bare;
}

// "CS310" -> "CS", "unc:COMP110" -> "unc:COMP"
export function deptOf(code) {
  return String(code).match(/^(?:[a-z]+:)?[A-Z]*/)[0];
}

// ("COMP", "unc") -> "unc:COMP", ("CS", "gmu") -> "CS"
export function deptKey(dept, school = DEFAULT_SCHOOL) {
  const bare = withoutSchool(dept).toUpperCase();
  return school === DEFAULT_SCHOOL ? bare : `${school}:${bare}`;
}

// The department a half-typed course code starts with: "math 2" -> "MATH", "cs" -> "CS".
// Null for text that can't be one ("Data Structures", "c").
export function deptOfText(text) {
  const match = String(text || '')
    .trim()
    .match(/^([A-Za-z]{2,5})(?:\s*-?\s*\d{0,4}[A-Za-z]?)?$/);
  return match ? match[1].toUpperCase() : null;
}

// Where a course's page and its department's list live.
export const coursePath = (code) => `/courses/${code}`;
export function deptPath(dept) {
  const school = schoolOf(dept);
  const query = new URLSearchParams({ ...(school !== DEFAULT_SCHOOL && { school }), dept: withoutSchool(dept) });
  return `/?${query}`;
}
