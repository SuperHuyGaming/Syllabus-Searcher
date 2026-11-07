// GMU's official catalog: every department and every course, with or without a
// syllabus. The scraper fills it each week (scraper/syllabus_scraper/store.py:
// save_department, count_syllabi). Two MongoDB collections:
//   departments -> { _id: 'CS', name: 'Computer Science', courses: 180, withSyllabi: 52 }
//   courses     -> { _id: 'CS310', dept: 'CS', title, credits, description, prereqs }
// It lives in MongoDB rather than DynamoDB because GMU has over ten thousand courses,
// and the DynamoDB table's small provisioned capacity is kept for the syllabi.
const config = require('../config');
const { getDb } = require('./files');
const { displayCourse } = require('../lib/terms');

const SEARCH_LIMIT = 20;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    // Every department, A to Z by name.
    async list() {
      const docs = await (await collection('departments')).find({}).sort({ name: 1 }).toArray();
      return docs.map(({ _id, name, courses, withSyllabi }) => ({
        code: _id,
        name: name || _id,
        courses: courses || 0,
        withSyllabi: withSyllabi || 0,
      }));
    },

    // True if courses in this department can be listed and uploaded. config.departments
    // are always covered, so uploads work before the scraper first loads the catalog.
    async exists(dept) {
      if (config.departments.includes(dept)) return true;
      return Boolean(await (await collection('departments')).findOne({ _id: dept }, { projection: { _id: 1 } }));
    },

    async get(dept) {
      const doc = await (await collection('departments')).findOne({ _id: dept });
      return doc ? { code: doc._id, name: doc.name || doc._id } : null;
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

    // Courses whose code starts with the query ("math 2", "CS") or whose title has every
    // word in it ("data struct"). Code matches come first.
    async search(query, limit = SEARCH_LIMIT) {
      const courses = await collection('courses');
      const text = String(query).trim();
      const code = text.replace(/[\s-]+/g, '').toUpperCase();
      const words = text.split(/\s+/).filter(Boolean).slice(0, 6);
      const projection = { projection: { title: 1, dept: 1 } };
      const [byCode, byTitle] = await Promise.all([
        /^[A-Z]{2,4}\d{0,3}[A-Z]?$/.test(code)
          ? courses.find({ _id: { $regex: `^${code}` } }, projection).sort({ _id: 1 }).limit(limit).toArray()
          : [],
        words.length
          ? courses
              .find({ $and: words.map((w) => ({ title: { $regex: escape(w), $options: 'i' } })) }, projection)
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
        { $inc: { withSyllabi: 1 }, $setOnInsert: { name: dept, courses: 0 } },
        { upsert: true }
      );
    },
  };
}

module.exports = { createDepartments };
