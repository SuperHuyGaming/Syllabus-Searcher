const { mergeCourses, mergeCourse } = require('../src/lib/courselist');

describe('course lists from the catalog and DynamoDB', () => {
  test('every catalog course is listed, plus old syllabus courses the catalog dropped', () => {
    const listed = [
      { code: 'CS310', display: 'CS 310', title: 'Data Structures (old name)', hasSyllabi: true },
      { code: 'CS499', display: 'CS 499', title: 'Special Topics', hasSyllabi: true },
    ];
    const official = [
      { code: 'CS310', display: 'CS 310', title: 'Data Structures' },
      { code: 'CS100', display: 'CS 100', title: 'Principles of Computing' },
    ];
    expect(mergeCourses(listed, official)).toEqual([
      { code: 'CS100', display: 'CS 100', title: 'Principles of Computing', hasSyllabi: false },
      { code: 'CS310', display: 'CS 310', title: 'Data Structures', hasSyllabi: true },
      { code: 'CS499', display: 'CS 499', title: 'Special Topics', hasSyllabi: true },
    ]);
  });

  test('sorts course numbers as numbers', () => {
    const official = [{ code: 'AE99' }, { code: 'AE100' }].map((c) => ({ ...c, title: '' }));
    expect(mergeCourses([], official).map((c) => c.code)).toEqual(['AE99', 'AE100']);
  });

  test('a course page takes the catalog details over the stored ones', () => {
    const course = { code: 'CS310', title: 'Old', credits: '', description: 'Old text', prereqs: '', offerings: [{ id: 'x' }] };
    const official = { code: 'CS310', title: 'Data Structures', credits: '3', description: 'Lists and trees.', prereqs: 'CS 211' };
    expect(mergeCourse(course, official)).toEqual({
      ...course,
      title: 'Data Structures',
      credits: '3',
      description: 'Lists and trees.',
      prereqs: 'CS 211',
    });
    expect(mergeCourse(course, null)).toBe(course);
  });

  test('a catalog course without syllabi gets an empty page', () => {
    const official = { code: 'MATH113', title: 'Calculus I', credits: '4', description: '', prereqs: '' };
    expect(mergeCourse(null, official)).toMatchObject({ code: 'MATH113', display: 'MATH 113', rollup: null, offerings: [] });
  });
});
