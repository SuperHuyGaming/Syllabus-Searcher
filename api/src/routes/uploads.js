const crypto = require('node:crypto');
const config = require('../config');
const { json, HttpError, bodyBuffer, clientIp } = require('../lib/http');
const { parseTerm, normalizeCourse } = require('../lib/terms');
const { analyzeSyllabus } = require('../lib/azure');

const SECTION = /^[A-Za-z0-9 ,-]{1,20}$/;
const INSTRUCTOR = /^[\p{L} .,'-]{2,80}$/u;

function validate(query) {
  const code = normalizeCourse(query.course);
  if (!code) throw new HttpError(400, 'Course code should look like "CS 310"');
  const dept = code.match(/^[A-Z]+/)[0];
  if (!config.departments.includes(dept)) throw new HttpError(400, `Only ${config.departments.join(', ')} courses for now`);

  const term = parseTerm(query.term);
  const thisYear = new Date().getFullYear();
  if (!term || term.year < 2000 || term.year > thisYear + 1) throw new HttpError(400, 'Term should look like "Fall 2024"');

  const section = String(query.section || '').trim();
  if (!SECTION.test(section)) throw new HttpError(400, 'Section should look like "001"');

  const instructor = String(query.instructor || '').trim();
  if (!INSTRUCTOR.test(instructor)) throw new HttpError(400, 'Enter the instructor name');

  return { code, term, section, instructor };
}

module.exports = ({ catalog, files, uploads, analyze = analyzeSyllabus }) => [
  {
    // The PDF is the raw request body; course details ride in the query string.
    method: 'POST',
    path: /^\/api\/uploads$/,
    async handler({ event, query }) {
      const details = validate(query);

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
