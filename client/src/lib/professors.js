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
