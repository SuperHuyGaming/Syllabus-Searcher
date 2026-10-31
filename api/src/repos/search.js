// Full-text search over syllabus contents. The scraper fills the "syllabus_text"
// collection and its text index (scraper/syllabus_scraper/store.py: index_text).
const { getDb } = require('./files');

const RESULT_LIMIT = 20;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// What to look for in the text: quoted phrases first, then single words,
// minus negations ("-java") and tiny words.
function terms(query) {
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);
  const words = query
    .replace(/"[^"]*"/g, ' ')
    .replace(/"/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !word.startsWith('-'));
  return [...phrases, ...words];
}

// Where a term starts in the text, at a word boundary so "late" doesn't match "related".
// MongoDB matches word stems ("programs" finds "programming"), so fall back to a word's start.
function find(text, term) {
  const exact = text.search(new RegExp(`\\b${escape(term)}`, 'i'));
  if (exact !== -1 || term.length <= 5 || term.includes(' ')) return exact;
  return text.search(new RegExp(`\\b${escape(term.slice(0, 5))}`, 'i'));
}

// ~240 characters around the first place the text mentions a search term.
function snippet(text, words, width = 240) {
  let at = -1;
  for (const word of words) {
    at = find(text, word);
    if (at !== -1) break;
  }
  if (at === -1) return text.slice(0, width);
  const start = Math.max(0, at - width / 3);
  const cut = text.slice(start, start + width);
  return `${start > 0 ? '…' : ''}${cut.slice(start > 0 ? cut.indexOf(' ') + 1 : 0)}${start + width < text.length ? '…' : ''}`;
}

function createSearch({ db } = {}) {
  const database = () => (db ? Promise.resolve(db) : getDb());

  return {
    async search(query) {
      const collection = (await database()).collection('syllabus_text');
      const docs = await collection
        .find({ $text: { $search: query } }, { projection: { score: { $meta: 'textScore' } } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(RESULT_LIMIT)
        .toArray();

      const words = terms(query);
      return docs.map(({ _id, text, score, ...rest }) => ({
        fileId: _id,
        ...rest,
        snippet: snippet(text || '', words),
        score: Math.round(score * 100) / 100,
      }));
    },
  };
}

module.exports = { createSearch, snippet, terms };
