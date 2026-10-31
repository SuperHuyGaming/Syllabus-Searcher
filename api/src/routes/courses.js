const config = require('../config');
const { json, binary, HttpError } = require('../lib/http');
const { normalizeCourse } = require('../lib/terms');
const { groupByProfessor } = require('../lib/professors');

// Course data changes only when the scraper runs or an upload is approved,
// so CloudFront can cache it for a while and Lambda rarely runs.
const CATALOG_CACHE = { 'Cache-Control': 'public, max-age=300, s-maxage=3600' };
// File ids never get reused, so a syllabus file can be cached forever.
const FILE_CACHE = { 'Cache-Control': 'public, max-age=31536000, immutable' };
// Scraped HTML syllabi are untrusted: sandbox them so their scripts can't run on our domain.
const HTML_SANDBOX = {
  'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src * data:",
};

module.exports = ({ catalog, files }) => [
  {
    method: 'GET',
    path: /^\/api\/courses$/,
    async handler({ query }) {
      const dept = (query.dept || 'CS').toUpperCase();
      if (!config.departments.includes(dept)) throw new HttpError(400, `Unsupported department: ${dept}`);
      const courses = await catalog.listCourses(dept);
      courses.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
      return json(200, { dept, courses }, CATALOG_CACHE);
    },
  },
  {
    method: 'GET',
    path: /^\/api\/courses\/([^/]+)$/,
    async handler({ params }) {
      const code = normalizeCourse(decodeURIComponent(params[0]));
      if (!code) throw new HttpError(400, 'Course code should look like "CS 310"');
      const course = await catalog.getCourse(code);
      if (!course) throw new HttpError(404, `No syllabi found for ${code}`);
      return json(200, course, CATALOG_CACHE);
    },
  },
  {
    method: 'GET',
    path: /^\/api\/professors$/,
    async handler() {
      const professors = groupByProfessor(await catalog.listOfferings());
      return json(200, { professors }, CATALOG_CACHE);
    },
  },
  {
    method: 'GET',
    path: /^\/api\/syllabi\/([a-f0-9]{24})$/,
    async handler({ params }) {
      const file = await files.read('syllabi', params[0]);
      if (!file) throw new HttpError(404, 'Syllabus not found');
      const extra = file.contentType.startsWith('text/html') ? HTML_SANDBOX : {};
      return binary(file.buffer, file.contentType, {
        ...FILE_CACHE,
        ...extra,
        'Content-Disposition': `inline; filename="${file.filename.replace(/"/g, '')}"`,
        'X-Content-Type-Options': 'nosniff',
      });
    },
  },
];
