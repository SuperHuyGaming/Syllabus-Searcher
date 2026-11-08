// Course catalogs: every school, department and course, with or without a syllabus.
// The scraper fills them each week (scraper/syllabus_scraper/store.py: save_school,
// save_department, count_syllabi). Three MongoDB collections:
//   schools     -> { _id: 'unc', name: 'University of North Carolina at Chapel Hill', departments, courses }
//   departments -> { _id: 'unc:COMP', school: 'unc', name: 'Computer Science', courses: 180, withSyllabi: 2 }
//   courses     -> { _id: 'unc:COMP110', school: 'unc', dept: 'unc:COMP', title, credits, description, prereqs }
// GMU keys have no prefix ('CS', 'CS310'; lib/terms.js), and GMU documents written
// before other schools existed have no `school` field, so a missing one means GMU.
// The catalogs live in MongoDB rather than DynamoDB because a school has thousands of
// courses, and the DynamoDB table's small provisioned capacity is kept for the syllabi.
const config = require('../config');
const { getDb } = require('./files');
const { displayCourse, withoutSchool, schoolOf, DEFAULT_SCHOOL } = require('../lib/terms');

const SEARCH_LIMIT = 20;
const GMU = { key: DEFAULT_SCHOOL, name: 'George Mason University', short: 'GMU', city: 'Fairfax, VA', departments: 0, courses: 0 };

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// MongoDB filter for one school's documents.
const inSchool = (school) => (school === DEFAULT_SCHOOL ? { school: { $in: [DEFAULT_SCHOOL, null] } } : { school });

const courseOf = ({ _id, dept, title, credits, description, prereqs }) => ({
  code: _id,
  dept,
  display: displayCourse(_id),
  title,
  credits: credits || '',
  description: description || '',
  prereqs: prereqs || '',
});

function createDepartments({ db } = {}) {
  const database = () => (db ? Promise.resolve(db) : getDb());
  const collection = async (name) => (await database()).collection(name);

  return {
    // Every school, GMU first, then A to Z. GMU is listed even before its catalog loads.
    async schools() {
      const docs = await (await collection('schools')).find({}).toArray();
      const schools = docs.map(({ _id, name, short, city, departments, courses }) => ({
        key: _id,
        name: name || _id,
        short: short || name || _id,
        city: city || '',
        departments: departments || 0,
        courses: courses || 0,
      }));
      if (!schools.some((s) => s.key === DEFAULT_SCHOOL)) schools.push(GMU);
      return schools.sort((a, b) => Number(b.key === DEFAULT_SCHOOL) - Number(a.key === DEFAULT_SCHOOL) || a.name.localeCompare(b.name));
    },

    async schoolExists(key) {
      if (key === DEFAULT_SCHOOL) return true;
      return Boolean(await (await collection('schools')).findOne({ _id: key }, { projection: { _id: 1 } }));
    },

    // A school's short name for messages ("GMU", "UNC").
    async schoolName(key) {
      const doc = await (await collection('schools')).findOne({ _id: key }, { projection: { name: 1, short: 1 } });
      return doc?.short || doc?.name || (key === DEFAULT_SCHOOL ? GMU.short : key.toUpperCase());
    },

    // One school's departments, A to Z by name. `code` is the key ("unc:COMP"), `display` the bare code.
    async list(school = DEFAULT_SCHOOL) {
      const docs = await (await collection('departments')).find(inSchool(school)).sort({ name: 1 }).toArray();
      return docs.map(({ _id, name, courses, withSyllabi }) => ({
        code: _id,
        display: withoutSchool(_id),
        name: name || withoutSchool(_id),
        courses: courses || 0,
        withSyllabi: withSyllabi || 0,
      }));
    },

    // True if courses in this department ("CS", "unc:COMP") can be listed and uploaded.
    // config.departments (GMU) are always covered, so uploads work before the first scrape.
    async exists(dept) {
      if (config.departments.includes(dept)) return true;
      return Boolean(await (await collection('departments')).findOne({ _id: dept }, { projection: { _id: 1 } }));
    },

    async get(dept) {
      const doc = await (await collection('departments')).findOne({ _id: dept });
      return doc ? { code: doc._id, display: withoutSchool(doc._id), name: doc.name || withoutSchool(doc._id) } : null;
    },

    // One department's catalog courses (code, display, title).
    async courses(dept) {
      const docs = await (await collection('courses')).find({ dept }, { projection: { title: 1 } }).toArray();
      return docs.map(({ _id, title }) => ({ code: _id, display: displayCourse(_id), title }));
    },

    // A course's catalog entry, or null if the catalog doesn't list it.
    async course(code) {
      const doc = await (await collection('courses')).findOne({ _id: code });
      return doc ? courseOf(doc) : null;
    },

    // One school's courses whose code starts with the query ("math 2", "CS") or whose
    // title has every word in it ("data struct"). Code matches come first.
    async search(query, school = DEFAULT_SCHOOL, limit = SEARCH_LIMIT) {
      const courses = await collection('courses');
      const text = String(query).trim();
      const code = text.replace(/[\s-]+/g, '').toUpperCase();
      const prefix = school === DEFAULT_SCHOOL ? '' : `${school}:`;
      const words = text.split(/\s+/).filter(Boolean).slice(0, 6);
      const projection = { projection: { title: 1, dept: 1 } };
      const [byCode, byTitle] = await Promise.all([
        /^[A-Z]{2,5}\d{0,4}[A-Z]?$/.test(code)
          ? courses.find({ _id: { $regex: `^${escape(prefix)}${code}` } }, projection).sort({ _id: 1 }).limit(limit).toArray()
          : [],
        words.length
          ? courses
              .find(
                { $and: [inSchool(school), ...words.map((w) => ({ title: { $regex: escape(w), $options: 'i' } }))] },
                projection
              )
              .sort({ _id: 1 })
              .limit(limit)
              .toArray()
          : [],
      ]);
      const seen = new Set();
      return [...byCode, ...byTitle]
        .filter((doc) => !seen.has(doc._id) && seen.add(doc._id))
        .slice(0, limit)
        .map(({ _id, dept, title }) => ({ code: _id, dept, display: displayCourse(_id), title }));
    },

    // A course just got its first syllabus. The scraper's weekly count corrects any drift.
    async addCourseWithSyllabi(dept) {
      await (await collection('departments')).updateOne(
        { _id: dept },
        { $inc: { withSyllabi: 1 }, $setOnInsert: { name: withoutSchool(dept), school: schoolOf(dept), courses: 0 } },
        { upsert: true }
      );
    },
  };
}

module.exports = { createDepartments, inSchool };
