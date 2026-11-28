const config = require('../config');
const { json, xml, binary, redirect, HttpError } = require('../lib/http');
const { isAllowedLink } = require('../repos/files');
const { normalizeCourse, displayCourse, schoolOf, deptOf, deptKey, withoutSchool, DEFAULT_SCHOOL } = require('../lib/terms');
const { mergeCourses, mergeCourse } = require('../lib/courselist');
const { groupByProfessor } = require('../lib/professors');
const { buildSitemap, newerIso, resolveSiteUrl } = require('../lib/sitemap');

// Browsers re-check every time (max-age=0), so an admin's approve or edit shows up
// on the next page load. CloudFront shares one copy for up to a minute, which keeps
// Lambda calls to about one per page per minute.
const CATALOG_CACHE = { 'Cache-Control': 'public, max-age=0, s-maxage=60' };
// Sitemap changes only on scrapes or approved uploads; CloudFront caches it for an hour.
const SITEMAP_CACHE = { 'Cache-Control': 'public, max-age=0, s-maxage=3600' };
// File ids never get reused, so a syllabus file can be cached forever.
const FILE_CACHE = { 'Cache-Control': 'public, max-age=31536000, immutable' };
// Link-only redirects use a short cache so removals or link changes take effect quickly.
const LINK_CACHE = { 'Cache-Control': 'public, max-age=300' };
// Scraped HTML syllabi are untrusted: sandbox them so their scripts can't run on our domain.
const HTML_SANDBOX = {
  'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src * data:",
};

module.exports = ({ catalog, departments, files, search, coverage }) => {
  const hintsRepo = coverage || departments;
  // ?school=unc picks a school; GMU when it's left out, so old links keep working.
  async function schoolParam(query) {
    const school = String(query.school || DEFAULT_SCHOOL).toLowerCase();
    if (!/^[a-z]{2,12}$/.test(school) || !(await departments.schoolExists(school))) {
      throw new HttpError(404, `No school called "${school}" on the site`);
    }
    return school;
  }

  return [
    {
      method: 'GET',
      path: /^\/api\/search$/,
      async handler({ query }) {
        const q = String(query.q || '').trim();
        if (q.length < 2) throw new HttpError(400, 'Type at least 2 characters');
        if (q.length > 100) throw new HttpError(400, 'Search is limited to 100 characters');
        const school = await schoolParam(query);
        return json(200, { query: q, school, results: await search.search(q, school) }, CATALOG_CACHE);
      },
    },
    {
      method: 'GET',
      path: /^\/api\/schools$/,
      async handler() {
        return json(200, { schools: await departments.schools() }, CATALOG_CACHE);
      },
    },
    {
      method: 'GET',
      path: /^\/api\/departments$/,
      async handler({ query }) {
        const school = await schoolParam(query);
        return json(200, { school, departments: await departments.list(school) }, CATALOG_CACHE);
      },
    },
    {
      method: 'GET',
      path: /^\/api\/courses$/,
      // ?dept=MATH lists one department; ?q=data struct finds courses in any department.
      // Both take ?school=unc; "dept" may also be the full key ("unc:COMP").
      async handler({ query }) {
        if (query.q !== undefined) {
          const q = String(query.q).trim();
          if (q.length < 2) throw new HttpError(400, 'Type at least 2 characters');
          if (q.length > 60) throw new HttpError(400, 'Search is limited to 60 characters');
          const found = await departments.search(q, await schoolParam(query));
          const withSyllabi = await catalog.coursesWithSyllabi(found.map((c) => c.code));
          const courses = found.map((c) => ({ ...c, hasSyllabi: withSyllabi.has(c.code) }));
          return json(200, { query: q, courses }, CATALOG_CACHE);
        }
        const raw = String(query.dept || 'CS');
        const school = raw.includes(':') ? schoolOf(raw) : await schoolParam(query);
        const bare = withoutSchool(raw).toUpperCase();
        const dept = deptKey(bare, school);
        const known = /^[A-Z]{2,5}$/.test(bare) && (await departments.exists(dept));
        if (!known) throw new HttpError(404, `${bare} isn't a department at ${await departments.schoolName(school)}`);
        const [listed, official, info] = await Promise.all([
          catalog.listCourses(dept),
          departments.courses(dept),
          departments.get(dept),
        ]);
        return json(
          200,
          { dept, display: bare, school, name: info?.name || bare, courses: mergeCourses(listed, official) },
          CATALOG_CACHE
        );
      },
    },
    {
      method: 'GET',
      path: /^\/api\/courses\/([^/]+)$/,
      async handler({ params }) {
        const code = normalizeCourse(decodeURIComponent(params[0]));
        if (!code) throw new HttpError(400, 'Course code should look like "CS 310"');
        const [course, official, hasOnlineHint] = await Promise.all([
          catalog.getCourse(code),
          departments.course(code),
          hintsRepo?.hasOnlineHint ? hintsRepo.hasOnlineHint(code) : false,
        ]);
        if (!course && !official) {
          throw new HttpError(404, `${displayCourse(code)} isn't in the ${await departments.schoolName(schoolOf(code))} catalog`);
        }
        const merged = mergeCourse(course, official);
        const linked =
          merged.offerings?.length && files?.linkedIds
            ? await files.linkedIds(merged.offerings.map((o) => o.fileId))
            : new Set();
        const offerings = linked.size
          ? merged.offerings.map((o) => (linked.has(o.fileId) ? { ...o, linked: true } : o))
          : merged.offerings;
        return json(
          200,
          { ...merged, offerings, hasOnlineHint: Boolean(hasOnlineHint), school: schoolOf(code), dept: deptOf(code) },
          CATALOG_CACHE
        );
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
      // One school's professors: the same name at two schools is two people.
      async handler({ query }) {
        const school = await schoolParam(query);
        const offerings = (await catalog.listOfferings()).filter((o) => schoolOf(o.code) === school);
        return json(200, { school, professors: groupByProfessor(offerings) }, CATALOG_CACHE);
      },
    },
    {
      method: 'GET',
      path: /^\/api\/sitemap\.xml$/,
      async handler({ event }) {
        const [schools, offerings, status] = await Promise.all([
          departments.schools(),
          catalog.listOfferings(),
          catalog.getStatus(),
        ]);
        const lastUpdated = newerIso(status?.scrapedAt, status?.uploadedAt);
        const baseUrl = resolveSiteUrl(event, config.siteUrl);
        return xml(buildSitemap({ baseUrl, schools, offerings, lastUpdated }), SITEMAP_CACHE);
      },
    },
    {
      method: 'GET',
      path: /^\/api\/syllabi\/([a-f0-9]{24})$/,
      async handler({ params }) {
        const file = await files.read('syllabi', params[0]);
        if (!file) throw new HttpError(404, 'Syllabus not found');
        if (file.link) {
          if (!isAllowedLink(file.link)) throw new HttpError(404, 'Syllabus not found');
          return redirect(file.link, LINK_CACHE);
        }
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
};
