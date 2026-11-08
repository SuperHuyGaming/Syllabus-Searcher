// Renames a professor on every syllabus that lists them, the same way an admin edit
// in the Published tab does: the offering is rewritten, a scraped file is marked as
// curated so the weekly scrape keeps the new name, and search gets the new name too.
const { parseTerm, deptOf, schoolOf } = require('./terms');
const { parseInstructor } = require('./details');

// With `school`, only that school's syllabi change: the same name at two schools is two people.
async function renameProfessor({ catalog, search }, from, to, { apply = false, by = 'rename-professor', school } = {}) {
  const oldName = String(from || '').trim();
  const newName = parseInstructor(to);
  if (!oldName) throw new Error('Give the current name to replace');
  if (oldName === newName) throw new Error('The new name is the same as the old one');

  const offerings = (await catalog.offeringsByInstructor(oldName)).filter((o) => !school || schoolOf(o.code) === school);
  const changes = offerings
    .map((old) => ({
      old,
      instructors: [...new Set(old.instructors.map((name) => (name === oldName ? newName : name)))],
    }))
    .sort((a, b) => a.old.code.localeCompare(b.old.code) || b.old.termKey.localeCompare(a.old.termKey));

  if (apply) {
    for (const { old, instructors } of changes) {
      await catalog.updateOffering(old, {
        dept: deptOf(old.code),
        code: old.code,
        title: old.title,
        term: parseTerm(old.termKey),
        section: old.section,
        instructors,
      });
      await catalog.markCurated(old.sourceUrl, { action: 'edited', by });
    }
    for (const fileId of new Set(changes.map((c) => c.old.fileId))) {
      await search?.refresh(fileId, await catalog.offeringsForFile(fileId));
    }
  }

  return changes.map(({ old, instructors }) => ({
    code: old.code,
    term: old.termLabel,
    section: old.section,
    before: old.instructors,
    after: instructors,
  }));
}

module.exports = { renameProfessor };
