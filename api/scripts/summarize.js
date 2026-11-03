// Writes AI summaries for published syllabi that don't have one yet (see src/lib/summary.js).
// Uploads get theirs when approved; this backfills scraped syllabi and retries any that
// failed. Free tiers allow a limited number of requests a day, so it stops after --limit
// files and waits --delay seconds between them; the next run picks up the rest.
//
//   node scripts/summarize.js                  # up to 40 files without a summary
//   node scripts/summarize.js --limit 5
//   node scripts/summarize.js --redo           # also replaces existing (and edited) summaries
//
// Uses TABLE_NAME, AWS_REGION, MONGODB_URI, MONGODB_DB and the AI_* keys like the API.
// In GitHub it runs from Actions → "Summarize syllabi", weekly and on demand.
const { createCatalog } = require('../src/repos/catalog');
const { createFiles } = require('../src/repos/files');
const { summarizeFile } = require('../src/lib/summary');

function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
}

async function main() {
  const args = process.argv.slice(2);
  const limit = option(args, '--limit', 40);
  const delay = option(args, '--delay', 5);
  const redo = args.includes('--redo');
  if (!(limit > 0) || !(delay >= 0)) throw new Error('Usage: summarize.js [--limit N] [--delay seconds] [--redo]');

  const catalog = createCatalog();
  const files = createFiles();
  const offerings = await catalog.listOfferings();
  const done = redo ? new Set() : await catalog.summarizedFileIds();
  const byFile = new Map();
  for (const o of offerings) if (!done.has(o.fileId) && !byFile.has(o.fileId)) byFile.set(o.fileId, o);

  const todo = [...byFile.values()].slice(0, limit);
  console.log(`${byFile.size} syllabus file(s) need a summary; doing ${todo.length}.`);
  let saved = 0;
  for (const [i, o] of todo.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    const result = await summarizeFile({ catalog, files, fileId: o.fileId });
    const label = `${o.display} ${o.termLabel} sec ${o.section}`;
    if (result.unavailable) {
      console.log(`- ${label}: skipped (${result.unavailable})`);
      // Out of free quota: later files would fail the same way.
      if (/quota/.test(result.unavailable)) break;
    } else {
      saved += 1;
      console.log(`- ${label}: saved (${result.provider})`);
    }
  }
  console.log(`Saved ${saved} summary(ies). ${byFile.size - saved} left for the next run.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message);
    process.exit(1);
  }
);
