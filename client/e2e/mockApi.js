// Fake /api responses shaped like the real API, so tests don't need a backend.
export const FILE_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
export const FILE_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
export const FILE_C = 'cccccccccccccccccccccccc';

const courses = [
  { code: 'CS105', display: 'CS 105', title: 'Computer Ethics and Society', hasSyllabi: false },
  { code: 'CS310', display: 'CS 310', title: 'Data Structures', hasSyllabi: true },
  { code: 'CS483', display: 'CS 483', title: 'Analysis of Algorithms', hasSyllabi: true },
];

const departments = [
  { code: 'CS', name: 'Computer Science', courses: 3, withSyllabi: 2 },
  { code: 'MATH', name: 'Mathematics', courses: 1, withSyllabi: 0 },
];
const coursesByDept = {
  CS: courses,
  MATH: [{ code: 'MATH113', display: 'MATH 113', title: 'Analytic Geometry and Calculus I', hasSyllabi: false }],
};

// Same matching as the API: a code prefix ("math 1") or every word in the title.
function findCourses(q) {
  const code = q.replace(/[\s-]+/g, '').toUpperCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(coursesByDept)
    .flat()
    .filter((c) => c.code.startsWith(code) || words.every((w) => c.title.toLowerCase().includes(w)));
}

// In the official catalog but no syllabus on file yet.
const cs105 = {
  code: 'CS105',
  display: 'CS 105',
  title: 'Computer Ethics and Society',
  credits: '1',
  description: 'Intensive introduction to legal, social, and ethical issues surrounding software development.',
  prereqs: '',
  offerings: [],
};

const cs310 = {
  code: 'CS310',
  display: 'CS 310',
  title: 'Data Structures',
  credits: '3',
  description: 'Fundamental data structures and their implementations.',
  prereqs: 'CS 211 (C) and MATH 113 (C)',
  rollup: {
    rollup: {
      overview: 'Across these syllabi, CS 310 usually covers lists, trees and hashing in Java.',
      topics: ['Linked lists', 'Hash tables'],
      tools: ['Java'],
      grading: [{ item: 'Projects', weight: '30-40%' }],
      workload: ['4 to 6 programming projects'],
      textbooks: [],
      differences: ['Masri, W gives weekly quizzes; Russell, K does not.'],
    },
    provider: 'Gemini',
    generatedAt: '2026-11-09T12:00:00Z',
    fileIds: [FILE_A, FILE_B],
  },
  offerings: [
    {
      termKey: '2024-3',
      termLabel: 'Fall 2024',
      section: '001',
      instructors: ['Russell, K'],
      fileId: FILE_A,
      source: 'gmu-cs',
      summary: {
        summary: {
          overview: 'Lists, trees and hash tables, built in Java.',
          topics: ['Linked lists', 'Binary search trees'],
          tools: ['Java'],
          grading: [{ item: 'Projects', weight: '40%' }],
          workload: ['5 programming projects'],
          textbooks: [],
          prerequisites: '',
          policies: { lateWork: '', attendance: '', aiUse: 'Not allowed on projects.' },
        },
        provider: 'Gemini',
        generatedAt: '2026-11-02T12:00:00Z',
      },
    },
    {
      termKey: '2024-3',
      termLabel: 'Fall 2024',
      section: '002',
      instructors: ['Masri, W'],
      fileId: FILE_B,
      pdfFileId: FILE_C,
      contentType: 'text/html; charset=utf-8',
      source: 'gmu-cs',
    },
    { termKey: '2023-1', termLabel: 'Spring 2023', section: 'All', instructors: ['Russell, K'], fileId: FILE_C, source: 'gmu-cs-filename' },
  ],
};

const professors = [
  {
    name: 'Gonzalez Samudio, David',
    slug: 'gonzalez-samudio-david',
    courses: ['CS211'],
    offerings: [
      {
        termKey: '2024-1',
        termLabel: 'Spring 2024',
        section: 'ALL',
        code: 'CS211',
        display: 'CS 211',
        title: 'Object-Oriented Programming',
        fileId: FILE_B,
        source: 'gmu-cs',
        coInstructors: ['Hrolenok, Brian'],
      },
    ],
  },
  {
    name: 'Masri, W',
    slug: 'masri-w',
    courses: ['CS310'],
    offerings: [{ ...cs310.offerings[1], code: 'CS310', display: 'CS 310', title: 'Data Structures', coInstructors: [] }],
  },
  {
    name: 'Russell, K',
    slug: 'russell-k',
    courses: ['CS310', 'CS483'],
    offerings: [
      { ...cs310.offerings[0], code: 'CS310', display: 'CS 310', title: 'Data Structures', coInstructors: [] },
      {
        termKey: '2023-1',
        termLabel: 'Spring 2023',
        section: '001',
        code: 'CS483',
        display: 'CS 483',
        title: 'Analysis of Algorithms',
        fileId: FILE_C,
        source: 'gmu-cs',
        coInstructors: [],
      },
    ],
  },
];

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

export async function mockApi(page, { onUpload } = {}) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/departments') return route.fulfill(json({ departments }));
    if (path === '/api/courses') {
      const q = url.searchParams.get('q');
      if (q !== null) return route.fulfill(json({ query: q, courses: findCourses(q.trim()) }));
      const dept = (url.searchParams.get('dept') || 'CS').toUpperCase();
      const name = departments.find((d) => d.code === dept)?.name;
      if (!name) return route.fulfill(json({ error: `${dept} isn't a GMU department` }, 404));
      return route.fulfill(json({ dept, name, courses: coursesByDept[dept] }));
    }
    if (path === '/api/courses/CS310') return route.fulfill(json(cs310));
    if (path === '/api/courses/CS105') return route.fulfill(json(cs105));
    if (path.startsWith('/api/courses/')) return route.fulfill(json({ error: 'No syllabi found for CS999' }, 404));
    if (path === '/api/professors') return route.fulfill(json({ professors }));
    if (path === '/api/status') {
      const lastUpdated = '2026-11-01T12:00:00.000Z';
      return route.fulfill(json({ lastUpdated, scrapedAt: lastUpdated, uploadedAt: null }));
    }
    if (path === '/api/search') {
      const q = url.searchParams.get('q');
      const results = /python/i.test(q)
        ? [
            {
              fileId: FILE_A,
              codes: ['CS310'],
              title: 'Data Structures',
              termLabel: 'Fall 2024',
              section: '001',
              instructors: ['Russell, K'],
              snippet: '…All assignments are written in Python and submitted on Gradescope…',
            },
          ]
        : [];
      return route.fulfill(json({ query: q, results }));
    }
    if (path === '/api/uploads' && route.request().method() === 'POST') {
      onUpload?.(url.searchParams, route.request());
      return route.fulfill(json({ id: 'x', status: 'pending' }, 201));
    }
    return route.fulfill(json({ error: 'Not found' }, 404));
  });
}
