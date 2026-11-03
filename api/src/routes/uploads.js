const crypto = require('node:crypto');
const config = require('../config');
const { json, HttpError, bodyBuffer, clientIp } = require('../lib/http');
const { analyzeSyllabus } = require('../lib/azure');
const { parseDetails } = require('../lib/details');
const { sanitizePdf, PdfRejected } = require('../lib/pdfcheck');
const { checkUpload: aiCheck } = require('../lib/ai');
const { fileText } = require('../lib/text');
const { aiReview } = require('../lib/review');

// What kind of file the body is, by its first bytes: a PDF, or an HTML page
// (some professors post their syllabus as a web page). Anything else is refused.
function fileKind(buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { type: 'application/pdf', ext: 'pdf' };
  const start = buffer.subarray(0, 1024).toString('utf8').trimStart().toLowerCase();
  const html = /^(<!--[\s\S]*?-->\s*)*<(!doctype html|html)[\s>]/.test(start);
  return html ? { type: 'text/html; charset=utf-8', ext: 'html' } : null;
}

module.exports = ({ catalog, files, uploads, analyze = analyzeSyllabus, checkUpload = aiCheck, readText = fileText }) => [
  {
    // The PDF is the raw request body; course details ride in the query string.
    method: 'POST',
    path: /^\/api\/uploads$/,
    async handler({ event, query }) {
      const details = parseDetails(query);

      const file = bodyBuffer(event);
      if (file.length === 0) throw new HttpError(400, 'Attach a PDF or HTML file');
      if (file.length > config.maxFileBytes) throw new HttpError(413, 'File must be under 4 MB');
      const kind = fileKind(file);
      if (!kind) throw new HttpError(415, 'Only PDF or HTML files are accepted');

      const ipHash = crypto.createHash('sha256').update(config.ipHashSalt + clientIp(event)).digest('hex');
      if (!(await catalog.hitRateLimit(ipHash, config.uploadsPerHour))) {
        throw new HttpError(429, 'Too many uploads. Try again in an hour.');
      }

      // A PDF is stored as a rebuilt copy with scripts and attachments removed.
      let stored = file;
      let fileCheck = { status: 'html' };
      if (kind.ext === 'pdf') {
        try {
          ({ buffer: stored, check: fileCheck } = await sanitizePdf(file));
        } catch (err) {
          if (err instanceof PdfRejected) throw new HttpError(422, err.message);
          throw err;
        }
      }

      const fileId = await files.save('pending', stored, {
        filename: `${details.code}_${details.term.key}_${details.section}.${kind.ext}`,
        contentType: kind.type,
        metadata: { course: details.code, termKey: details.term.key, section: details.section },
      });

      // Azure reads PDFs only; the AI check reads both. They run side by side, and
      // neither can fail the upload: the admin reviews by hand without them.
      const [found, ai] = await Promise.all([
        kind.ext === 'pdf' ? analyze(stored) : null,
        aiReview({ catalog, buffer: stored, contentType: kind.type, details, readText, checkUpload }).catch((err) => {
          console.error('AI check failed', err);
          return { unavailable: 'The AI check failed.', checkedAt: new Date().toISOString() };
        }),
      ]);
      const row = await uploads.create({
        course_code: details.code,
        term_key: details.term.key,
        section: details.section,
        instructor: details.instructor,
        file_id: fileId,
        file_size: stored.length,
        uploader_ip_hash: ipHash,
        detected: { ...found, fileCheck, ai },
      });

      return json(201, { id: row.id, status: row.status });
    },
  },
];
