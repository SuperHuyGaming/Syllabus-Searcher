const { json, binary, HttpError } = require('../lib/http');
const { normalizeCourse, displayCourse } = require('../lib/terms');
const { mergeCourses, mergeCourse } = require('../lib/courselist');
const { groupByProfessor } = require('../lib/professors');

// Browsers re-check every time (max-age=0), so an admin's approve or edit shows up
// on the next page load. CloudFront shares one copy for up to a minute, which keeps
// Lambda calls to about one per page per minute.
const CATALOG_CACHE = { 'Cache-Control': 'public, max-age=0, s-maxage=60' };
// File ids never get reused, so a syllabus file can be cached forever.
const FILE_CACHE = { 'Cache-Control': 'public, max-age=31536000, immutable' };
// Scraped HTML syllabi are untrusted: sandbox them so their scripts can't run on our domain.
const HTML_SANDBOX = {
  'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src * data:",
};

module.exports = ({ catalog, departments, files, search }) => [
  {
    method: 'GET',
    path: /^\/api\/search$/,
    async handler({ query }) {
      const q = String(query.q || '').trim();
      if (q.length < 2) throw new HttpError(400, 'Type at least 2 characters');
      if (q.length > 100) throw new HttpError(400, 'Search is limited to 100 characters');
      return json(200, { query: q, results: await search.search(q) }, CATALOG_CACHE);
    },
  },
  {
    method: 'GET',
    path: /^\/api\/departments$/,
    async handler() {
      return json(200, { departments: await departments.list() }, CATALOG_CACHE);
    },
  },
  {
    method: 'GET',
    path: /^\/api\/courses$/,
    // ?dept=MATH lists one department; ?q=data struct finds courses in any department.
    async handler({ query }) {
      if (query.q !== undefined) {
        const q = String(query.q).trim();
        if (q.length < 2) throw new HttpError(400, 'Type at least 2 characters');
        if (q.length > 60) throw new HttpError(400, 'Search is limited to 60 characters');
        const found = await departments.search(q);
        const withSyllabi = await catalog.coursesWithSyllabi(found.map((c) => c.code));
        const courses = found.map((c) => ({ ...c, hasSyllabi: withSyllabi.has(c.code) }));
        return json(200, { query: q, courses }, CATALOG_CACHE);
      }
      const dept = String(query.dept || 'CS').toUpperCase();
      const known = /^[A-Z]{2,4}$/.test(dept) && (await departments.exists(dept));
      if (!known) throw new HttpError(404, `${dept} isn't a GMU department`);
      const [listed, official, info] = await Promise.all([
        catalog.listCourses(dept),
        departments.courses(dept),
        departments.get(dept),
      ]);
      return json(200, { dept, name: info?.name || dept, courses: mergeCourses(listed, official) }, CATALOG_CACHE);
    },
  },
  {
    method: 'GET',
    path: /^\/api\/courses\/([^/]+)$/,
    async handler({ params }) {
      const code = normalizeCourse(decodeURIComponent(params[0]));
      if (!code) throw new HttpError(400, 'Course code should look like "CS 310"');
      const [course, official] = await Promise.all([catalog.getCourse(code), departments.course(code)]);
      if (!course && !official) throw new HttpError(404, `${displayCourse(code)} isn't in the GMU catalog`);
      return json(200, mergeCourse(course, official), CATALOG_CACHE);
    },
  },
  {
    method: 'GET',
    path: /^\/api\/status$/,
    // When the data last changed: the last full scrape or the last approved upload, whichever is newer.
    async handler() {
      const { scrapedAt = null, uploadedAt = null } = await catalog.getStatus();
      const times = [scrapedAt, uploadedAt].filter((t) => t && !Number.isNaN(Date.parse(t)));
      const lastUpdated = times.length ? new Date(Math.max(...times.map(Date.parse))).toISOString() : null;
      return json(200, { lastUpdated, scrapedAt, uploadedAt }, CATALOG_CACHE);
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
