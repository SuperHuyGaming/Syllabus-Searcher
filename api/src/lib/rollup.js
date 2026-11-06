// Course-level rollup: one AI overview of a course made from the summaries of its
// syllabi ("across all professors, CS 310 usually covers..."). Built by
// scripts/summarize.js after the per-file summaries, and only for courses with at
// least two summarized syllabi. Saved as PK=ROLLUP, SK=<course code>.
const { summarizeCourse } = require('./ai');

// Enough syllabi to see a pattern without a long prompt; the newest ones win.
const MAX_SOURCES = 12;

/**
 * offerings: every offering of the course. summaries: Map of fileId -> summary record.
 * Returns the summarized files to build from, newest term first, one per file
 * (a syllabus shared by several sections counts once).
 */
function rollupSources(offerings, summaries) {
  const byFile = new Map();
  const newest = [...offerings].sort((a, b) => String(b.termKey).localeCompare(String(a.termKey)));
  for (const o of newest) {
    const record = summaries.get(o.fileId);
    if (!record?.summary || byFile.has(o.fileId)) continue;
    const who = (o.instructors || []).join('; ');
    byFile.set(o.fileId, {
      fileId: o.fileId,
      label: [o.termLabel, who].filter(Boolean).join(', ') || `Section ${o.section}`,
      summary: record.summary,
      changedAt: record.editedAt || record.generatedAt || '',
    });
  }
  return [...byFile.values()].slice(0, MAX_SOURCES);
}

// What to do with a course's rollup: 'delete' (too few syllabi left), 'build' or 'keep'.
function rollupAction(existing, sources) {
  if (sources.length < 2) return existing ? 'delete' : 'keep';
  if (!existing) return 'build';
  const ids = (list) => [...list].sort().join(',');
  if (ids(existing.fileIds || []) !== ids(sources.map((s) => s.fileId))) return 'build';
  // A summary regenerated or edited since the rollup was made.
  if (sources.some((s) => s.changedAt > (existing.generatedAt || ''))) return 'build';
  return 'keep';
}

/**
 * Builds and saves one course's rollup. Returns the saved record, or { unavailable: why }.
 */
async function rollupCourse({ catalog, course, sources, summarize = summarizeCourse, timeoutMs }) {
  const result = await summarize(course, sources, { timeoutMs });
  if (result.unavailable) return result;
  const record = {
    rollup: result.rollup,
    provider: result.provider,
    model: result.model,
    generatedAt: result.generatedAt,
    fileIds: sources.map((s) => s.fileId),
  };
  await catalog.putRollup(course.code, record);
  return record;
}

module.exports = { rollupSources, rollupAction, rollupCourse, MAX_SOURCES };
