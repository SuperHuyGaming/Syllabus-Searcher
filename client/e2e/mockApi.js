// Fake /api responses shaped like the real API, so tests don't need a backend.
export const FILE_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
export const FILE_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
export const FILE_C = 'cccccccccccccccccccccccc';

const courses = [
  { code: 'CS105', display: 'CS 105', title: 'Computer Ethics and Society', hasSyllabi: false },
  { code: 'CS310', display: 'CS 310', title: 'Data Structures', hasSyllabi: true },
  { code: 'CS483', display: 'CS 483', title: 'Analysis of Algorithms', hasSyllabi: true },
];

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
    if (path === '/api/courses') return route.fulfill(json({ dept: 'CS', courses }));
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
