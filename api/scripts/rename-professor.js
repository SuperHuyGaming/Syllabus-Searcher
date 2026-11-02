// Renames a professor on every syllabus that lists them (see src/lib/rename.js).
// Shows what would change unless --apply is given.
//
//   node scripts/rename-professor.js "Yu, L" "Yu, Craig"           # dry run
//   node scripts/rename-professor.js "Yu, L" "Yu, Craig" --apply
//
// Uses TABLE_NAME, AWS_REGION, MONGODB_URI and MONGODB_DB like the API. In GitHub,
// run it from Actions → "Rename professor", which sets them for each environment.
const { createCatalog } = require('../src/repos/catalog');
const { createSearch } = require('../src/repos/search');
const { renameProfessor } = require('../src/lib/rename');

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [from, to] = args.filter((a) => a !== '--apply');
  if (!from || !to) throw new Error('Usage: rename-professor.js "Old, Name" "New, Name" [--apply]');

  const changes = await renameProfessor({ catalog: createCatalog(), search: createSearch() }, from, to, { apply });
  for (const c of changes) {
    console.log(`${c.code} ${c.term} sec ${c.section}: ${c.before.join('; ')} -> ${c.after.join('; ')}`);
  }
  const verb = apply ? 'Renamed' : 'Would rename (dry run, add --apply)';
  console.log(`${verb}: ${changes.length} syllabus listing(s) from "${from}" to "${to}".`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message);
    process.exit(1);
  }
);
