// Makes and saves the AI summary of one published syllabus file. Used when an admin
// approves an upload or presses "Regenerate", and by scripts/summarize.js, which
// backfills scraped syllabi from GitHub Actions.
const { summarize: aiSummarize } = require('./ai');
const { fileText } = require('./text');

/**
 * Returns the saved record { summary, provider, model, generatedAt },
 * or { unavailable: why } when the file is missing or no AI answered (nothing is saved).
 */
async function summarizeFile({ catalog, files, fileId, readText = fileText, summarize = aiSummarize, timeoutMs }) {
  const file = await files.read('syllabi', fileId);
  if (!file) return { unavailable: 'The syllabus file is missing.' };

  let text = '';
  try {
    text = await readText(file.buffer, file.contentType);
  } catch (err) {
    console.error('reading syllabus text failed', err);
  }
  const result = await summarize(text, { timeoutMs });
  if (result.unavailable) return result;

  const record = {
    summary: result.summary,
    provider: result.provider,
    model: result.model,
    generatedAt: result.generatedAt,
  };
  await catalog.putSummary(fileId, record);
  return record;
}

module.exports = { summarizeFile };
