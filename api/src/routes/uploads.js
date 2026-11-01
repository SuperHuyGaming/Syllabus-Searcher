const crypto = require('node:crypto');
const config = require('../config');
const { json, HttpError, bodyBuffer, clientIp } = require('../lib/http');
const { analyzeSyllabus } = require('../lib/azure');
const { parseDetails } = require('../lib/details');

// What kind of file the body is, by its first bytes: a PDF, or an HTML page
// (some professors post their syllabus as a web page). Anything else is refused.
function fileKind(buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { type: 'application/pdf', ext: 'pdf' };
  const start = buffer.subarray(0, 1024).toString('utf8').trimStart().toLowerCase();
  const html = /^(<!--[\s\S]*?-->\s*)*<(!doctype html|html)[\s>]/.test(start);
  return html ? { type: 'text/html; charset=utf-8', ext: 'html' } : null;
}

module.exports = ({ catalog, files, uploads, analyze = analyzeSyllabus }) => [
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

      const fileId = await files.save('pending', file, {
        filename: `${details.code}_${details.term.key}_${details.section}.${kind.ext}`,
        contentType: kind.type,
        metadata: { course: details.code, termKey: details.term.key, section: details.section },
      });

      // Azure reads PDFs only; an HTML page is reviewed by eye.
      const detected = kind.ext === 'pdf' ? await analyze(file) : null;
      const row = await uploads.create({
        course_code: details.code,
        term_key: details.term.key,
        section: details.section,
        instructor: details.instructor,
        file_id: fileId,
        file_size: file.length,
        uploader_ip_hash: ipHash,
        detected,
      });

      return json(201, { id: row.id, status: row.status });
    },
  },
];
