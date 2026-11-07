// Courses come from two places: GMU's catalog in MongoDB (repos/departments.js), which
// lists every course, and DynamoDB (repos/catalog.js), which has the courses with
// syllabi, including old ones the catalog no longer lists. These put the two together.
const { displayCourse } = require('./terms');

// One department's list: every catalog course, plus syllabus courses missing from it.
// The catalog's title wins; hasSyllabi comes from DynamoDB.
function mergeCourses(listed, official) {
  const byCode = new Map(official.map((c) => [c.code, { ...c, hasSyllabi: false }]));
  for (const course of listed) {
    const known = byCode.get(course.code);
    byCode.set(course.code, known ? { ...known, hasSyllabi: course.hasSyllabi } : course);
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}

// One course page. `course` (DynamoDB) has the syllabi, `official` (catalog) the
// title, credits, description and prerequisites. Either may be null, not both.
function mergeCourse(course, official) {
  if (!course) {
    return {
      code: official.code,
      display: displayCourse(official.code),
      title: official.title,
      credits: official.credits,
      description: official.description,
      prereqs: official.prereqs,
      rollup: null,
      offerings: [],
    };
  }
  if (!official) return course;
  return {
    ...course,
    title: official.title || course.title,
    credits: official.credits || course.credits,
    description: official.description || course.description,
    prereqs: official.prereqs || course.prereqs,
  };
}

module.exports = { mergeCourses, mergeCourse };
