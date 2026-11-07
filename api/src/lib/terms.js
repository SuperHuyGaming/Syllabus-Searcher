// Terms sort as "<year>-<n>" where Spring=1, Summer=2, Fall=3, so a plain
// string sort (or a descending DynamoDB query) lists newest terms first.
const SEASONS = ['Spring', 'Summer', 'Fall'];

function parseTerm(input) {
  if (!input) return null;
  const text = String(input).trim();

  const keyMatch = text.match(/^(\d{4})-([123])$/);
  if (keyMatch) {
    const year = Number(keyMatch[1]);
    const season = SEASONS[Number(keyMatch[2]) - 1];
    return { year, season, key: text, label: `${season} ${year}` };
  }

  const labelMatch = text.match(/^(spring|summer|fall)[\s_-]*(\d{4})$/i);
  if (!labelMatch) return null;
  const season = labelMatch[1][0].toUpperCase() + labelMatch[1].slice(1).toLowerCase();
  const year = Number(labelMatch[2]);
  return { year, season, key: `${year}-${SEASONS.indexOf(season) + 1}`, label: `${season} ${year}` };
}

// Course codes carry their school. GMU, the first school, keeps bare codes ("CS310",
// department "CS") so nothing stored before other schools existed had to change;
// every other school prefixes its key ("unc:COMP110", department "unc:COMP").
const DEFAULT_SCHOOL = 'gmu';
const SCHOOL = /^[a-z]{2,12}$/;

// "cs 310", "CS-310", "cs310" -> "CS310"; with school "unc", "comp 110" -> "unc:COMP110".
// A typed prefix wins over the school given: "unc:COMP 110" -> "unc:COMP110".
function normalizeCourse(input, school = DEFAULT_SCHOOL) {
  if (!input) return null;
  const match = String(input)
    .trim()
    .match(/^(?:([A-Za-z]{2,12})\s*:\s*)?([A-Za-z]{2,5})\s*-?\s*(\d{3,4}[A-Za-z]?)$/);
  if (!match) return null;
  const key = (match[1] || school || DEFAULT_SCHOOL).toLowerCase();
  if (!SCHOOL.test(key)) return null;
  const bare = `${match[2].toUpperCase()}${match[3].toUpperCase()}`;
  return key === DEFAULT_SCHOOL ? bare : `${key}:${bare}`;
}

// "unc:COMP110" -> "unc", "CS310" -> "gmu". Also works on departments ("unc:COMP").
function schoolOf(code) {
  const match = String(code).match(/^([a-z]+):/);
  return match ? match[1] : DEFAULT_SCHOOL;
}

// "unc:COMP110" -> "unc:COMP", "CS310" -> "CS"
function deptOf(code) {
  return String(code).match(/^(?:[a-z]+:)?[A-Z]+/)[0];
}

// "unc:COMP" -> "COMP": a department or course code without its school.
function withoutSchool(code) {
  return String(code).replace(/^[a-z]+:/, '');
}

// The department key for a school: ("CS", "gmu") -> "CS", ("COMP", "unc") -> "unc:COMP".
function deptKey(dept, school = DEFAULT_SCHOOL) {
  const bare = withoutSchool(dept).toUpperCase();
  return school === DEFAULT_SCHOOL ? bare : `${school}:${bare}`;
}

// "CS310" -> "CS 310", "unc:COMP110" -> "COMP 110"
function displayCourse(code) {
  const bare = withoutSchool(code);
  const match = bare.match(/^([A-Z]+)(\d.*)$/);
  return match ? `${match[1]} ${match[2]}` : bare;
}

module.exports = {
  parseTerm,
  normalizeCourse,
  displayCourse,
  schoolOf,
  deptOf,
  deptKey,
  withoutSchool,
  DEFAULT_SCHOOL,
  SEASONS,
};
