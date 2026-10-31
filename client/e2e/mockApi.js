// Fake /api responses shaped like the real API, so tests don't need a backend.
export const FILE_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
export const FILE_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
export const FILE_C = 'cccccccccccccccccccccccc';

const courses = [
  { code: 'CS310', display: 'CS 310', title: 'Data Structures' },
  { code: 'CS483', display: 'CS 483', title: 'Analysis of Algorithms' },
];

const cs310 = {
  code: 'CS310',
  display: 'CS 310',
  title: 'Data Structures',
  offerings: [
    { termKey: '2024-3', termLabel: 'Fall 2024', section: '001', instructors: ['Russell, K'], fileId: FILE_A, source: 'gmu-cs' },
    { termKey: '2024-3', termLabel: 'Fall 2024', section: '002', instructors: ['Masri, W'], fileId: FILE_B, source: 'gmu-cs' },
    { termKey: '2023-1', termLabel: 'Spring 2023', section: 'All', instructors: ['Russell, K'], fileId: FILE_C, source: 'gmu-cs-filename' },
  ],
};

const professors = [
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
    if (path.startsWith('/api/courses/')) return route.fulfill(json({ error: 'No syllabi found for CS999' }, 404));
    if (path === '/api/professors') return route.fulfill(json({ professors }));
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
