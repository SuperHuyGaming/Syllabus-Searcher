// Coverage reports and online syllabus hints (Studocu, Course Hero, etc.).
// Written by the scraper (scraper/syllabus_scraper/coverage.py and search.py)
// into two MongoDB collections:
//   coverage       -> { _id: 'gmu', school: 'gmu', computedAt, totals, departments }
//   syllabus_hints -> { code, school, url, title, snippet, host, foundAt }
// Public endpoints may only expose a boolean `hasOnlineHint` (never hint URLs);
// full hint details are admin-only.
const { getDb } = require('./files');
const { displayCourse, schoolOf, withoutSchool, DEFAULT_SCHOOL } = require('../lib/terms');

const inSchool = (school) => (school === DEFAULT_SCHOOL ? { school: { $in: [DEFAULT_SCHOOL, null] } } : { school });

function sortDepartments(departments = []) {
  return [...departments].sort(
    (a, b) => (b.withoutSyllabi || 0) - (a.withoutSyllabi || 0) || String(a.dept || '').localeCompare(String(b.dept || ''))
  );
}

function createCoverage({ db } = {}) {
  const database = () => (db ? Promise.resolve(db) : getDb());
  const collection = async (name) => (await database()).collection(name);

  return {
    async getCoverage(school = DEFAULT_SCHOOL) {
      const doc = await (await collection('coverage')).findOne({ $or: [{ _id: school }, { school }] });
      if (!doc) return null;
      return {
        school: doc.school || school,
        computedAt: doc.computedAt || null,
        totals: {
          courses: doc.totals?.courses || 0,
          withSyllabi: doc.totals?.withSyllabi || 0,
          withoutSyllabi: doc.totals?.withoutSyllabi || 0,
        },
        departments: sortDepartments(doc.departments).map((d) => ({
          dept: d.dept,
          courses: d.courses || 0,
          withSyllabi: d.withSyllabi || 0,
          withoutSyllabi: d.withoutSyllabi || 0,
          missingCourses: Array.isArray(d.missingCourses) ? d.missingCourses : [],
        })),
      };
    },

    async listHints(school = DEFAULT_SCHOOL) {
      const docs = await (await collection('syllabus_hints'))
        .find(inSchool(school))
        .sort({ foundAt: -1 })
        .toArray();
      return docs.map(({ code, school: docSchool, url, title, snippet, host, foundAt }) => ({
        code,
        school: docSchool || DEFAULT_SCHOOL,
        url: url || '',
        title: title || '',
        snippet: snippet || '',
        host: host || '',
        foundAt: foundAt || null,
      }));
    },

    async hasOnlineHint(code) {
      const school = schoolOf(code);
      const bare = withoutSchool(code);
      const display = displayCourse(code);
      const candidates = [...new Set([code, bare, display])];
      const doc = await (await collection('syllabus_hints')).findOne(
        { code: { $in: candidates }, ...inSchool(school) },
        { projection: { _id: 1 } }
      );
      return Boolean(doc);
    },
  };
}

module.exports = { createCoverage, sortDepartments };
