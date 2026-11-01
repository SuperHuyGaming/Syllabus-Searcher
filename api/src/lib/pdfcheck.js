// Uploaded PDFs are untrusted. A file can start with %PDF- and still carry
// JavaScript, auto-run actions or embedded files, so every upload is parsed and
// rebuilt from its pages before it's stored. The stored file is that rebuilt copy,
// with anything risky the copy still holds stripped out, never the student's bytes.
const { PDFDocument, PDFDict, PDFArray, PDFName, PDFStream, PDFRef } = require('pdf-lib');

const MAX_PAGES = 50;

// Keys that hold scripts, attachments or media, with the label the admin sees.
const RISKY_KEYS = {
  JS: 'JavaScript',
  JavaScript: 'JavaScript',
  EmbeddedFile: 'embedded file',
  EmbeddedFiles: 'embedded file',
  RichMedia: 'embedded media',
  RichMediaContent: 'embedded media',
  XFA: 'XFA form',
};

// Link actions that are fine to keep: web links and jumps inside the document.
const SAFE_ACTIONS = new Set(['URI', 'GoTo', 'Named']);
const ACTION_LABELS = {
  JavaScript: 'JavaScript',
  Launch: 'launch action',
  SubmitForm: 'form submit',
  ImportData: 'form submit',
};

const RISKY_ANNOTS = { FileAttachment: 'embedded file', RichMedia: 'embedded media', Screen: 'embedded media', Movie: 'embedded media', Sound: 'embedded media', '3D': 'embedded media' };

class PdfRejected extends Error {}

const nameOf = (value) => (value instanceof PDFName ? value.decodeText() : null);

// Walks every object in the file. Reports risky things it finds and, with
// `strip`, deletes them. Returns the labels found.
function sweep(context, { strip }) {
  const found = new Set();
  const lookup = (value) => (value instanceof PDFRef ? context.lookup(value) : value);

  // The type of an action that isn't a plain link or page jump, else null.
  // A destination array (open at page 1, fit width) isn't an action at all.
  function unsafeAction(value) {
    const action = lookup(value);
    const type = action instanceof PDFDict ? nameOf(action.get(PDFName.of('S'))) : null;
    return type && !SAFE_ACTIONS.has(type) ? type : null;
  }

  function visit(value) {
    if (value instanceof PDFStream) return visit(value.dict);
    if (value instanceof PDFArray) return value.asArray().forEach(visit);
    if (!(value instanceof PDFDict)) return;

    for (const key of value.keys()) {
      const name = key.decodeText();
      const entry = value.get(key);

      if (RISKY_KEYS[name]) {
        found.add(RISKY_KEYS[name]);
        if (strip) value.delete(key);
        continue;
      }

      // Actions that run on open, on page view or on form events. Many normal PDFs
      // just open at page 1 this way, so it's only reported when it does more than
      // jump to a page, but the stored copy never keeps any of them.
      if (name === 'OpenAction' || name === 'AA') {
        const actions = name === 'AA' && lookup(entry) instanceof PDFDict ? lookup(entry).values() : [entry];
        if (actions.some(unsafeAction)) found.add('auto-run action');
        if (strip) {
          value.delete(key);
          continue;
        }
      }

      // A link or chained action: keep web links and page jumps only.
      if (name === 'A' || name === 'Next') {
        const type = unsafeAction(entry);
        if (type) {
          found.add(ACTION_LABELS[type] || `${type} action`);
          if (strip) value.delete(key);
          continue;
        }
      }

      if (name === 'Annots' && entry instanceof PDFArray) {
        for (let i = entry.size() - 1; i >= 0; i -= 1) {
          const annot = lookup(entry.get(i));
          const subtype = annot instanceof PDFDict ? nameOf(annot.get(PDFName.of('Subtype'))) : null;
          if (RISKY_ANNOTS[subtype]) {
            found.add(RISKY_ANNOTS[subtype]);
            if (strip) entry.remove(i);
          }
        }
      }

      visit(entry);
    }
  }

  for (const [, object] of context.enumerateIndirectObjects()) visit(object);
  return [...found].sort();
}

// Returns { buffer, check } where buffer is the rebuilt PDF to store and check is
// what the admin card shows. Throws PdfRejected with a message for the student.
async function sanitizePdf(buffer, { maxPages = MAX_PAGES } = {}) {
  let source;
  let pages;
  try {
    // Loaded with ignoreEncryption only so it can be refused with a clear message.
    source = await PDFDocument.load(buffer, { updateMetadata: false, ignoreEncryption: true });
    if (!source.isEncrypted) pages = source.getPageCount();
  } catch {
    throw new PdfRejected("This PDF couldn't be read. Try exporting it again as a PDF.");
  }
  if (source.isEncrypted) {
    throw new PdfRejected('This PDF is password-protected or encrypted. Save an unprotected copy and upload that.');
  }

  if (pages === 0) throw new PdfRejected('This PDF has no pages.');
  if (pages > maxPages) throw new PdfRejected(`A syllabus should be under ${maxPages} pages; this PDF has ${pages}.`);

  const removed = sweep(source.context, { strip: false });

  // Copying the pages into a new file leaves behind document-level scripts,
  // attachments and forms. The sweep then clears anything left on the pages.
  const copy = await PDFDocument.create({ updateMetadata: false });
  for (const page of await copy.copyPages(source, source.getPageIndices())) copy.addPage(page);
  sweep(copy.context, { strip: true });

  return {
    buffer: Buffer.from(await copy.save()),
    check: { status: removed.length ? 'stripped' : 'clean', pages, removed },
  };
}

module.exports = { sanitizePdf, PdfRejected, MAX_PAGES };
