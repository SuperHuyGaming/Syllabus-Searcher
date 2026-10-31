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
