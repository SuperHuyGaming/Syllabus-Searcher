// Turns the flat list of offerings into one entry per professor.
// Names come straight from the syllabus listings ("Zaman, A", or just "Kamberi"
// when a row listed several people), so the same person can appear in two forms.
const PLACEHOLDERS = new Set(['staff', 'all', 'all instructors', 'all professors', 'tba']);

const plain = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function professorSlug(name) {
  return plain(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function groupByProfessor(offerings) {
  const byName = new Map();
  for (const offering of offerings) {
    for (const name of offering.instructors || []) {
      if (PLACEHOLDERS.has(name.toLowerCase())) continue;
      const slug = professorSlug(name);
      if (!slug) continue;
      if (!byName.has(slug)) byName.set(slug, { name, slug, offerings: [] });
      const { instructors, ...rest } = offering;
      byName.get(slug).offerings.push({ ...rest, coInstructors: instructors.filter((n) => n !== name) });
    }
  }

  const merge = (slug, into) => {
    into.offerings.push(...byName.get(slug).offerings);
    byName.delete(slug);
  };

  // "Zhu, Z" (a syllabus whose text didn't spell the name out) joins "Zhu, Ziwei"
  // when that's the only full name with the same surname and initial.
  for (const [slug, professor] of byName) {
    const [last, first = ''] = professor.name.split(',').map((part) => plain(part.trim()));
    if (first.replace('.', '').length !== 1) continue;
    const matches = [...byName.values()].filter((p) => {
      const [otherLast, otherFirst = ''] = p.name.split(',').map((part) => plain(part.trim()));
      return otherLast === last && otherFirst.length > 1 && otherFirst.startsWith(first[0]);
    });
    if (matches.length === 1) merge(slug, matches[0]);
  }

  // "Abdelmoumin" (from a multi-instructor row) joins "Abdelmoumin, G" when that's
  // the only professor with the surname. With two ("Chen, J" and "Chen, S") it stays apart.
  for (const [slug, professor] of byName) {
    if (professor.name.includes(',')) continue;
    const surname = plain(professor.name);
    const matches = [...byName.values()].filter((p) => plain(p.name).startsWith(`${surname},`));
    if (matches.length !== 1) continue;
    matches[0].offerings.push(...professor.offerings);
    byName.delete(slug);
  }

  return [...byName.values()]
    .map((professor) => ({
      ...professor,
      courses: [...new Set(professor.offerings.map((o) => o.code))].sort(),
      offerings: professor.offerings.sort(
        (a, b) => b.termKey.localeCompare(a.termKey) || a.code.localeCompare(b.code, 'en', { numeric: true })
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { professorSlug, groupByProfessor };
