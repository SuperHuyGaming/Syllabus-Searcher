import { deptOfText, normalizeCourse, withoutSchool } from './courses';
import { matchProfessors } from './professors';

// Suggestions for the home page's one search box, the way Rate My Professors works:
// first it finds the school, then subjects, courses and professors at that school.

const plain = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const words = (text) => plain(text).split(/[^a-z0-9]+/).filter(Boolean);

// Every typed word starts a word of the text: "north car" finds "University of North Carolina".
const startsWords = (text, typed) => {
  const have = words(text);
  return typed.length > 0 && typed.every((t) => have.some((w) => w.startsWith(t)));
};

// Schools whose name, short name, key or city matches. With nothing typed, all of them.
export function matchSchools(schools, text, limit = 6) {
  const typed = words(text);
  if (typed.length === 0) return schools.slice(0, limit);
  const compact = typed.join('');
  return schools
    .filter(
      (s) =>
        startsWords(s.name, typed) ||
        startsWords(s.city, typed) ||
        plain(s.short).replace(/[^a-z0-9]/g, '').startsWith(compact) ||
        s.key.startsWith(compact)
    )
    .slice(0, limit);
}

// Departments whose code starts with the typed text ("cs", "math 113" -> MATH) or whose name
// matches its words ("comp sci"). An exact code comes first, then other code matches,
// then name matches, each in the list's order. With nothing typed, every subject A to Z.
export function matchSubjects(departments, text, limit = 5) {
  const typed = words(text);
  if (typed.length === 0) return [...departments].sort((a, b) => a.name.localeCompare(b.name));
  const code = deptOfText(text);
  const course = /\d/.test(text);
  const rank = (d) => {
    if (code && d.display === code) return 0;
    if (code && !course && d.display.startsWith(code)) return 1;
    if (startsWords(d.name, typed)) return 2;
    return null;
  };
  return departments
    .map((d, i) => ({ d, i, r: rank(d) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.d);
}

// Courses matching a code ("CS310", "cs 310", "cs-310") or title words ("data struct").
// Exact course code matches come first, then code prefixes, then title word starts,
// then title substrings, preserving list order within each tier.
export function matchCourses(courses, text, limit = 5) {
  const trimmed = String(text || '').trim();
  const typed = words(trimmed);
  if (typed.length === 0) return [];
  const normalized = normalizeCourse(trimmed);
  const exact = normalized ? withoutSchool(normalized) : null;
  const compact = plain(trimmed).replace(/[^a-z0-9]/g, '').toUpperCase();
  const codeLike = /^[A-Z]{2,5}\d{0,4}[A-Z]?$/.test(compact);
  const rank = (c) => {
    const bare = withoutSchool(c.code).toUpperCase();
    if ((exact && bare === exact) || (codeLike && bare === compact)) return 0;
    if (codeLike && bare.startsWith(compact)) return 1;
    if (startsWords(c.title, typed)) return 2;
    const title = plain(c.title);
    if (typed.every((w) => title.includes(w))) return 3;
    return null;
  };
  return courses
    .map((c, i) => ({ c, i, r: rank(c) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

// The box's list in subject mode, each with its `kind` for grouping and what it opens.
// Typed text with a digit ("cs 310") is a course, so courses come first; otherwise subjects.
export function subjectSuggestions({ departments = [], courses = [], professors = [], text = '' }) {
  const trimmed = text.trim();
  const subjects = matchSubjects(departments, trimmed, 4).map((d) => ({ kind: 'Subjects', key: `d:${d.code}`, item: d }));
  const found =
    trimmed.length >= 2 ? matchCourses(courses, trimmed, 5).map((c) => ({ kind: 'Courses', key: `c:${c.code}`, item: c })) : [];
  const people =
    words(trimmed).some((w) => /^[a-z]{2,}$/.test(w)) && !/\d/.test(trimmed)
      ? matchProfessors(professors, trimmed, 3).map((p) => ({ kind: 'Professors', key: `p:${p.slug}`, item: p }))
      : [];
  return /\d/.test(trimmed) ? [...found, ...subjects, ...people] : [...subjects, ...found, ...people];
}
