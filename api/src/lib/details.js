// Validates the course/term/section/professor fields shared by student uploads
// and admin edits, so both accept and normalize the same values.
const { HttpError } = require('./http');
const { parseTerm, normalizeCourse } = require('./terms');

const SECTION = /^[A-Za-z0-9 ,/-]{1,20}$/;
const INSTRUCTOR = /^[\p{L} .,'-]{2,80}$/u;

function parseCourse(input) {
  const code = normalizeCourse(input);
  if (!code) throw new HttpError(400, 'Course code should look like "CS 310"');
  return code;
}

const deptOf = (code) => code.match(/^[A-Z]+/)[0];

// A new syllabus must be for a GMU department (repos/departments.js), so a typo
// like "CD 310" doesn't start a department of its own.
async function requireDepartment(departments, code) {
  const dept = deptOf(code);
  if (!(await departments.exists(dept))) throw new HttpError(400, `${dept} isn't a GMU department. Check the course code.`);
  return dept;
}

function parseTermInput(input) {
  const term = parseTerm(input);
  const thisYear = new Date().getFullYear();
  if (!term || term.year < 2000 || term.year > thisYear + 1) throw new HttpError(400, 'Term should look like "Fall 2024"');
  return term;
}

function parseSection(input) {
  const section = String(input || '').trim();
  if (!SECTION.test(section)) throw new HttpError(400, 'Section should look like "001"');
  return section;
}

function parseInstructor(input) {
  const instructor = String(input || '').trim();
  if (!INSTRUCTOR.test(instructor)) throw new HttpError(400, 'Enter the instructor name');
  return instructor;
}

// Several professors can share an offering; the admin form separates them with ";".
function parseInstructors(input) {
  const names = (Array.isArray(input) ? input : String(input || '').split(';')).map((n) => String(n).trim()).filter(Boolean);
  if (names.length === 0 || names.length > 5) throw new HttpError(400, 'Enter one to five professors');
  return names.map(parseInstructor);
}

function parseDetails(input) {
  return {
    code: parseCourse(input.course),
    term: parseTermInput(input.term),
    section: parseSection(input.section),
    instructor: parseInstructor(input.instructor),
  };
}

// The admin review form, like the edit form, takes several professors separated by ";".
// `instructor` keeps them joined so it still fits the upload's single text column.
function parseReviewDetails(input) {
  const instructors = parseInstructors(input.instructor);
  return { ...parseDetails({ ...input, instructor: instructors[0] }), instructor: instructors.join('; '), instructors };
}

module.exports = { parseCourse, requireDepartment, deptOf, parseTermInput, parseSection, parseInstructor, parseInstructors, parseDetails, parseReviewDetails };
