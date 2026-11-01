const crypto = require('node:crypto');
const config = require('../config');
const { json, HttpError, bodyBuffer, clientIp } = require('../lib/http');
const { analyzeSyllabus } = require('../lib/azure');
const { parseDetails } = require('../lib/details');

module.exports = ({ catalog, files, uploads, analyze = analyzeSyllabus }) => [
  {
    // The PDF is the raw request body; course details ride in the query string.
    method: 'POST',
    path: /^\/api\/uploads$/,
    async handler({ event, query }) {
      const details = parseDetails(query);

      const pdf = bodyBuffer(event);
      if (pdf.length === 0) throw new HttpError(400, 'Attach a PDF');
      if (pdf.length > config.maxFileBytes) throw new HttpError(413, 'PDF must be under 4 MB');
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(415, 'Only PDF files are accepted');

      const ipHash = crypto.createHash('sha256').update(config.ipHashSalt + clientIp(event)).digest('hex');
      if (!(await catalog.hitRateLimit(ipHash, config.uploadsPerHour))) {
        throw new HttpError(429, 'Too many uploads. Try again in an hour.');
      }

      const fileId = await files.save('pending', pdf, {
        filename: `${details.code}_${details.term.key}_${details.section}.pdf`,
        contentType: 'application/pdf',
        metadata: { course: details.code, termKey: details.term.key, section: details.section },
      });

      const detected = await analyze(pdf);
      const row = await uploads.create({
        course_code: details.code,
        term_key: details.term.key,
        section: details.section,
        instructor: details.instructor,
        file_id: fileId,
        file_size: pdf.length,
        uploader_ip_hash: ipHash,
        detected,
      });

      return json(201, { id: row.id, status: row.status });
    },
  },
];
