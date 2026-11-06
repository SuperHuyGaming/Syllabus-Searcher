// Writes AI summaries for published syllabi that don't have one yet (see src/lib/summary.js).
// Uploads get theirs when approved; this backfills scraped syllabi and retries any that
// failed. Free tiers allow a limited number of requests a day, so it stops after --limit
// files and waits --delay seconds between them; the next run picks up the rest.
// Then it rebuilds the course-level rollups (src/lib/rollup.js) whose syllabi changed.
//
//   node scripts/summarize.js                  # up to 40 files without a summary, then 20 rollups
//   node scripts/summarize.js --limit 5 --rollups 0
//   node scripts/summarize.js --redo           # also replaces existing (and edited) summaries and rollups
//
// Uses TABLE_NAME, AWS_REGION, MONGODB_URI, MONGODB_DB and the AI_* keys like the API.
// In GitHub it runs from Actions → "Summarize syllabi", weekly and on demand.
const { createCatalog } = require('../src/repos/catalog');
const { createFiles } = require('../src/repos/files');
const { summarizeFile } = require('../src/lib/summary');
const { rollupSources, rollupAction, rollupCourse } = require('../src/lib/rollup');

const wait = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
}

async function main() {
  const args = process.argv.slice(2);
  const limit = option(args, '--limit', 40);
  const delay = option(args, '--delay', 5);
  const rollups = option(args, '--rollups', 20);
  const redo = args.includes('--redo');
  if (!(limit >= 0) || !(delay >= 0) || !(rollups >= 0)) {
    throw new Error('Usage: summarize.js [--limit N] [--rollups N] [--delay seconds] [--redo]');
  }

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
    if (i > 0) await wait(delay);
    const result = await summarizeFile({ catalog, files, fileId: o.fileId });
    const label = `${o.display} ${o.termLabel} sec ${o.section}`;
    if (result.unavailable) {
      console.log(`- ${label}: skipped (${result.unavailable})`);
      // Out of free quota: later files would fail the same way.
      if (/quota/.test(result.unavailable)) return console.log('Out of free AI quota; stopping.');
    } else {
      saved += 1;
      console.log(`- ${label}: saved (${result.provider})`);
    }
  }
  console.log(`Saved ${saved} summary(ies). ${byFile.size - saved} left for the next run.`);
  if (rollups > 0) await updateRollups({ catalog, offerings, limit: rollups, delay, pauseFirst: todo.length > 0, redo });
}

// Rebuilds the rollups of courses whose summarized syllabi changed, and removes
// rollups of courses that no longer have two.
async function updateRollups({ catalog, offerings, limit, delay, pauseFirst, redo }) {
  const summaries = await catalog.getSummaries(offerings.map((o) => o.fileId));
  const existing = await catalog.listRollups();
  const byCourse = new Map([...existing.keys()].map((code) => [code, []]));
  for (const o of offerings) {
    if (!byCourse.has(o.code)) byCourse.set(o.code, []);
    byCourse.get(o.code).push(o);
  }

  const todo = [];
  for (const [code, list] of byCourse) {
    const sources = rollupSources(list, summaries);
    const action = redo && sources.length >= 2 ? 'build' : rollupAction(existing.get(code), sources);
    if (action === 'delete') {
      await catalog.deleteRollup(code);
      console.log(`- ${code}: rollup removed (fewer than two summarized syllabi)`);
    } else if (action === 'build') {
      todo.push({ course: { code, display: list[0].display, title: list[0].title }, sources });
    }
  }

  console.log(`${todo.length} course rollup(s) need updating; doing ${Math.min(todo.length, limit)}.`);
  let saved = 0;
  for (const [i, { course, sources }] of todo.slice(0, limit).entries()) {
    if (i > 0 || pauseFirst) await wait(delay);
    const result = await rollupCourse({ catalog, course, sources });
    if (result.unavailable) {
      console.log(`- ${course.display}: rollup skipped (${result.unavailable})`);
      if (/quota/.test(result.unavailable)) break;
    } else {
      saved += 1;
      console.log(`- ${course.display}: rollup of ${sources.length} syllabi saved (${result.provider})`);
    }
  }
  console.log(`Saved ${saved} rollup(s). ${todo.length - saved} left for the next run.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message);
    process.exit(1);
  }
);
