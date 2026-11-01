// Validates the course/term/section/professor fields shared by student uploads
// and admin edits, so both accept and normalize the same values.
const config = require('../config');
const { HttpError } = require('./http');
const { parseTerm, normalizeCourse } = require('./terms');

const SECTION = /^[A-Za-z0-9 ,/-]{1,20}$/;
const INSTRUCTOR = /^[\p{L} .,'-]{2,80}$/u;

function parseCourse(input) {
  const code = normalizeCourse(input);
  if (!code) throw new HttpError(400, 'Course code should look like "CS 310"');
  const dept = code.match(/^[A-Z]+/)[0];
  if (!config.departments.includes(dept)) throw new HttpError(400, `Only ${config.departments.join(', ')} courses for now`);
  return code;
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

module.exports = { parseCourse, parseTermInput, parseSection, parseInstructor, parseInstructors, parseDetails };
