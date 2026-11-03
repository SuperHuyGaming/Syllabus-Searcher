// Runs the AI check for one upload: reads the file's text, looks up syllabi
// already published for the same course/term/section, and asks the model.
// Used when a student uploads and when an admin runs the check again.
const { displayCourse } = require('./terms');

async function aiReview({ catalog, buffer, contentType, details, readText, checkUpload }) {
  const course = await catalog.getCourse(details.code);
  const duplicates = (course?.offerings || [])
    .filter((o) => o.termKey === details.term.key && String(o.section).trim().toLowerCase() === details.section.toLowerCase())
    .map(({ section, instructors }) => ({ section, instructors }));

  let text = '';
  try {
    text = await readText(buffer, contentType);
  } catch (err) {
    console.error('reading upload text failed', err);
  }

  return checkUpload(
    text,
    {
      course: displayCourse(details.code),
      title: course?.title,
      term: details.term.label,
      section: details.section,
      instructor: details.instructor,
    },
    { duplicates }
  );
}

module.exports = { aiReview };
