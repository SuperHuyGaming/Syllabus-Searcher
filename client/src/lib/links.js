import { DEFAULT_SCHOOL, displayCourse, schoolOf } from './courses';

// CourseLeaf catalog origins per school key (matches scraper/syllabus_scraper/schools.py).
// Unknown schools return null so non-GMU courses never get broken GMU links.
const CATALOG_ORIGINS = {
  gmu: 'https://catalog.gmu.edu',
  gatech: 'https://catalog.gatech.edu',
  odu: 'https://catalog.odu.edu',
  unc: 'https://catalog.unc.edu',
};

// Rate My Professors school IDs where verified. Other schools fall back to general RMP search.
const RMP_SCHOOL_IDS = {
  gmu: '362',
};

const PLACEHOLDER_INSTRUCTOR = /^(staff|all|all instructors|all professors|tba)$/i;

export const DEFAULT_CONTACT_EMAIL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CONTACT_EMAIL) || 'contact@findmysyllabus.bentruong.dev';

// Official catalog search URL for a course code, e.g. "CS310" -> "https://catalog.gmu.edu/search/?P=CS+310",
// "unc:COMP110" -> "https://catalog.unc.edu/search/?P=COMP+110". Null for unknown schools or empty codes.
export function catalogCourseUrl(code) {
  if (!code || typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  const origin = CATALOG_ORIGINS[schoolOf(trimmed)];
  if (!origin) return null;
  const query = new URLSearchParams({ P: displayCourse(trimmed) });
  return `${origin}/search/?${query}`;
}

// Formats "Last, First" into "First Last" for Rate My Professors search.
// Single-letter initials ("Kamberi, S") search by surname ("Kamberi") so RMP finds the full name.
export function rmpSearchQuery(name) {
  const clean = String(name || '').trim();
  if (!clean || PLACEHOLDER_INSTRUCTOR.test(clean)) return '';
  const comma = clean.indexOf(',');
  if (comma === -1) return clean;
  const last = clean.slice(0, comma).trim();
  const first = clean.slice(comma + 1).trim();
  if (!first || first.replace(/\./g, '').length <= 1) return last;
  return `${first} ${last}`;
}

// Rate My Professors search URL for an instructor at a school.
// GMU uses school ID 362; other schools use the general RMP professor search.
export function rateMyProfessorsUrl(name, schoolKey = DEFAULT_SCHOOL) {
  const q = rmpSearchQuery(name);
  if (!q) return null;
  const schoolId = RMP_SCHOOL_IDS[String(schoolKey || DEFAULT_SCHOOL).toLowerCase()];
  const base = schoolId
    ? `https://www.ratemyprofessors.com/search/professors/${schoolId}`
    : 'https://www.ratemyprofessors.com/search/professors';
  return `${base}?q=${encodeURIComponent(q)}`;
}

// Prefilled mailto: link for an instructor requesting removal of a syllabus.
export function removalRequestUrl(
  { code = '', display = '', termLabel = '', section = '', instructors = [], fileId = '', id = '' } = {},
  email = DEFAULT_CONTACT_EMAIL
) {
  const course = display || (code ? displayCourse(code) : 'Unknown course');
  const term = termLabel || 'Unknown term';
  const people = Array.isArray(instructors) ? instructors.filter(Boolean).join('; ') : String(instructors || '');
  const subject = `Syllabus removal request: ${course} (${term})`;
  const lines = [
    'Hello,',
    '',
    'I am the instructor for this course and would like to request removal of the following syllabus:',
    '',
    `Course: ${course}${code && code !== course ? ` (${code})` : ''}`,
    `Term: ${term}`,
    ...(section ? [`Section: ${section}`] : []),
    ...(people ? [`Instructor: ${people}`] : []),
    ...(fileId ? [`Syllabus file ID: ${fileId}`] : []),
    ...(id ? [`Offering ID: ${id}`] : []),
    '',
    'Please let me know if you need any verification.',
  ];
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}
