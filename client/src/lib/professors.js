// Must match api/src/lib/professors.js so links line up with /api/professors slugs.
export function professorSlug(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// A bare surname ("Kamberi") may have been merged into "Kamberi, S" by the API,
// so fall back to the one professor whose slug extends it.
export function findProfessor(professors, slug) {
  const exact = professors.find((p) => p.slug === slug);
  if (exact) return exact;
  const extended = professors.filter((p) => p.slug.startsWith(`${slug}-`));
  return extended.length === 1 ? extended[0] : null;
}

const plain = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Splits "Gonzalez Samudio, David" into its words: gonzalez, samudio, david.
const nameWords = (name) => plain(name).split(/[\s,.'’-]+/).filter(Boolean);

// Professors whose first or last name starts with each typed word, the way
// RateMyProfessors search works: "david", "samudio", "gonz dav" all find
// "Gonzalez Samudio, David". Surname matches come first.
export function matchProfessors(professors, query, limit = Infinity) {
  const typed = nameWords(query);
  if (typed.length === 0) return professors.slice(0, limit);
  return professors
    .map((professor) => {
      const words = nameWords(professor.name);
      if (!typed.every((t) => words.some((w) => w.startsWith(t)))) return null;
      const surname = nameWords(professor.name.split(',')[0]);
      const rank = surname.some((w) => w.startsWith(typed[0])) ? 0 : 1;
      return { professor, rank };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.professor.name.localeCompare(b.professor.name))
    .slice(0, limit)
    .map(({ professor }) => professor);
}

const PLACEHOLDERS = /^(staff|all|tba)\b/i;
// How much of the first name is spelled out: "Ana" beats "A".
const firstNameLength = (name) => (name.split(',')[1] || '').trim().length;

// Groups stored spellings that may be one person, for the admin's merge tool:
// names whose surname starts with the same word, ignoring accents ("Gonzalez Hernandez, A"
// and "González, Ana"). The fullest name comes first as the one to keep.
export function likelySpellings(names) {
  const groups = new Map();
  for (const name of names) {
    if (PLACEHOLDERS.test(name)) continue;
    const [first] = nameWords(name.split(',')[0]);
    if (!first) continue;
    if (!groups.has(first)) groups.set(first, []);
    groups.get(first).push(name);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((a, b) => firstNameLength(b) - firstNameLength(a) || b.length - a.length))
    .sort((a, b) => a[0].localeCompare(b[0]));
}
