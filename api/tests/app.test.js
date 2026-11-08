const { PDFDocument } = require('pdf-lib');
const { createApp } = require('../src/app');

const PDF = Buffer.from('%PDF-1.7\nfake syllabus');
const UPLOAD_ID = '11111111-2222-3333-4444-555555555555';
const FILE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OFFERING = {
  PK: 'COURSE#CS580',
  SK: `TERM#2024-3#SEC#001#${FILE_ID}`,
  code: 'CS580',
  title: 'Introduction to Artificial Intelligence',
  termKey: '2024-3',
  termLabel: 'Fall 2024',
  section: '001',
  instructors: ['Zhu, Z'],
  fileId: FILE_ID,
  source: 'gmu-cs',
  sourceUrl: 'https://cs.gmu.edu/media/syllabi/Fall2024/CS_580ZhuZ001.pdf',
};

const AI = { verdict: 'legit', reasons: ['A CS 310 syllabus.'] };
const SUMMARY_RESULT = {
  summary: { overview: 'Data structures in Java.', topics: ['Trees'] },
  provider: 'Gemini',
  model: 'gemini-3.5-flash-lite',
  generatedAt: '2026-11-02T00:00:00.000Z',
};

function event(method, path, { query, body, headers } = {}) {
  return {
    rawPath: path,
    queryStringParameters: query,
    headers: headers || {},
    body: body ? Buffer.from(body).toString('base64') : undefined,
    isBase64Encoded: true,
    requestContext: { http: { method, sourceIp: '1.2.3.4' } },
  };
}

function fakes() {
  const pending = {
    id: UPLOAD_ID,
    status: 'pending',
    course_code: 'CS310',
    term_key: '2024-3',
    section: '001',
    instructor: 'Ada Lovelace',
    file_id: FILE_ID,
  };
  return {
    catalog: {
      listCourses: jest.fn().mockResolvedValue([
        { code: 'CS483', display: 'CS 483', title: 'Algorithms' },
        { code: 'CS310', display: 'CS 310', title: 'Data Structures' },
      ]),
      getCourse: jest.fn(async (code) =>
        code === 'CS310' ? { code, title: 'Data Structures', offerings: [{ termKey: '2024-3' }] } : null
      ),
      getCourseMeta: jest.fn().mockResolvedValue({ title: 'Data Structures' }),
      putOffering: jest.fn().mockResolvedValue({ firstSyllabus: false }),
      coursesWithSyllabi: jest.fn(async (codes) => new Set(codes.filter((c) => c === 'CS310'))),
      getOffering: jest.fn(async (code, id) => (code === 'CS580' && id === OFFERING.SK ? { ...OFFERING } : null)),
      offeringsForFile: jest.fn().mockResolvedValue([]),
      updateOffering: jest.fn(async (old, next) => ({ ...old, PK: `COURSE#${next.code}`, SK: 'TERM#new', code: next.code })),
      deleteOffering: jest.fn().mockResolvedValue(),
      putCourse: jest.fn().mockResolvedValue(),
      markCurated: jest.fn().mockResolvedValue(),
      getSummaries: jest.fn().mockResolvedValue(new Map()),
      putSummary: jest.fn().mockResolvedValue(),
      deleteSummary: jest.fn().mockResolvedValue(),
      hitRateLimit: jest.fn().mockResolvedValue(true),
      getStatus: jest.fn().mockResolvedValue({ scrapedAt: '2026-11-02T09:40:00.123456+00:00', uploadedAt: '2026-11-01T18:00:00.000Z' }),
      markUploaded: jest.fn().mockResolvedValue(),
      ping: jest.fn().mockResolvedValue(),
    },
    // GMU's catalog (MongoDB): CS and MATH, plus SWE with nothing loaded yet.
    departments: {
      list: jest.fn().mockResolvedValue([
        { code: 'CS', name: 'Computer Science', courses: 3, withSyllabi: 2 },
        { code: 'MATH', name: 'Mathematics', courses: 1, withSyllabi: 0 },
      ]),
      exists: jest.fn(async (dept) => ['CS', 'MATH', 'SWE', 'unc:COMP'].includes(dept)),
      get: jest.fn(async (dept) => ({ CS: { code: 'CS', name: 'Computer Science' }, MATH: { code: 'MATH', name: 'Mathematics' } })[dept] || null),
      courses: jest.fn(async (dept) =>
        dept === 'CS'
          ? [
              { code: 'CS310', display: 'CS 310', title: 'Data Structures' },
              { code: 'CS100', display: 'CS 100', title: 'Principles of Computing' },
            ]
          : [{ code: 'MATH113', display: 'MATH 113', title: 'Analytic Geometry and Calculus I' }]
      ),
      course: jest.fn(async (code) =>
        code === 'MATH113'
          ? { code, dept: 'MATH', display: 'MATH 113', title: 'Analytic Geometry and Calculus I', credits: '4', description: 'Limits.', prereqs: '' }
          : null
      ),
      search: jest.fn().mockResolvedValue([
        { code: 'CS310', dept: 'CS', display: 'CS 310', title: 'Data Structures' },
        { code: 'MATH113', dept: 'MATH', display: 'MATH 113', title: 'Analytic Geometry and Calculus I' },
      ]),
      addCourseWithSyllabi: jest.fn().mockResolvedValue(),
      schools: jest.fn().mockResolvedValue([
        { key: 'gmu', name: 'George Mason University', short: 'GMU' },
        { key: 'unc', name: 'University of North Carolina at Chapel Hill', short: 'UNC' },
      ]),
      schoolExists: jest.fn(async (key) => ['gmu', 'unc'].includes(key)),
      schoolName: jest.fn(async (key) => ({ gmu: 'GMU', unc: 'UNC' })[key] || key.toUpperCase()),
    },
    files: {
      save: jest.fn().mockResolvedValue(FILE_ID),
      read: jest.fn().mockResolvedValue({ buffer: PDF, contentType: 'application/pdf', filename: 'a.pdf' }),
      move: jest.fn().mockResolvedValue({ id: FILE_ID, contentType: 'application/pdf' }),
      remove: jest.fn().mockResolvedValue(),
      ping: jest.fn().mockResolvedValue(),
    },
    uploads: {
      create: jest.fn(async (row) => ({ id: UPLOAD_ID, status: 'pending', ...row })),
      listPending: jest.fn().mockResolvedValue([pending]),
      get: jest.fn().mockResolvedValue(pending),
      review: jest.fn(async (id, { status }) => ({ ...pending, status })),
      saveDetected: jest.fn(async (id, detected) => ({ ...pending, detected })),
      adminEmail: jest.fn(async (token) => (token === 'good' ? 'admin@gmu.edu' : null)),
      ping: jest.fn().mockResolvedValue(),
    },
    analyze: jest.fn().mockResolvedValue({ courseCodes: ['CS310'] }),
    readText: jest.fn().mockResolvedValue('CS 310 syllabus text'),
    checkUpload: jest.fn().mockResolvedValue(AI),
    virusScan: jest.fn().mockResolvedValue({ status: 'not-scanned' }),
    summarize: jest.fn().mockResolvedValue(SUMMARY_RESULT),
    search: { search: jest.fn(), refresh: jest.fn().mockResolvedValue() },
  };
}

const parse = (res) => JSON.parse(res.body);


describe('catalog routes', () => {
  test('status gives the newer of the last scrape and the last approved upload', async () => {
    const deps = fakes();
    const res = await createApp(deps)(event('GET', '/api/status'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toContain('s-maxage=60');
    expect(parse(res).lastUpdated).toBe('2026-11-02T09:40:00.123Z');

    deps.catalog.getStatus.mockResolvedValue({ uploadedAt: '2026-11-03T10:00:00.000Z' });
    expect(parse(await createApp(deps)(event('GET', '/api/status')))).toEqual({
      lastUpdated: '2026-11-03T10:00:00.000Z',
      scrapedAt: null,
      uploadedAt: '2026-11-03T10:00:00.000Z',
    });

    deps.catalog.getStatus.mockResolvedValue({});
    expect(parse(await createApp(deps)(event('GET', '/api/status'))).lastUpdated).toBeNull();
  });

  test('lists CS courses by default: the catalog plus syllabus courses, sorted by code', async () => {
    const app = createApp(fakes());
    const res = await app(event('GET', '/api/courses'));
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.name).toBe('Computer Science');
    expect(body.courses.map((c) => c.code)).toEqual(['CS100', 'CS310', 'CS483']);
    expect(body.courses.find((c) => c.code === 'CS100').hasSyllabi).toBe(false);
    expect(res.headers['Cache-Control']).toMatch(/s-maxage/);
  });

  test('lists another department from the catalog', async () => {
    const deps = fakes();
    deps.catalog.listCourses.mockResolvedValue([]);
    const res = await createApp(deps)(event('GET', '/api/courses', { query: { dept: 'math' } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toMatchObject({ dept: 'MATH', name: 'Mathematics', courses: [{ code: 'MATH113', hasSyllabi: false }] });
    expect(deps.catalog.listCourses).toHaveBeenCalledWith('MATH');
  });

  test('404s for a department GMU does not have', async () => {
    const res = await createApp(fakes())(event('GET', '/api/courses', { query: { dept: 'XYZ' } }));
    expect(res.statusCode).toBe(404);
  });

  test('lists every department', async () => {
    const res = await createApp(fakes())(event('GET', '/api/departments'));
    expect(res.statusCode).toBe(200);
    expect(parse(res).departments.map((d) => d.code)).toEqual(['CS', 'MATH']);
  });

  test('finds courses in any department and marks the ones with syllabi', async () => {
    const deps = fakes();
    const res = await createApp(deps)(event('GET', '/api/courses', { query: { q: ' calc ' } }));
    expect(res.statusCode).toBe(200);
    expect(deps.departments.search).toHaveBeenCalledWith('calc', 'gmu');
    expect(parse(res).courses.map((c) => [c.code, c.hasSyllabi])).toEqual([
      ['CS310', true],
      ['MATH113', false],
    ]);
  });

  test('course search needs two characters', async () => {
    const res = await createApp(fakes())(event('GET', '/api/courses', { query: { q: 'c' } }));
    expect(res.statusCode).toBe(400);
  });

  test('looks up a course with a spaced code', async () => {
    const deps = fakes();
    const res = await createApp(deps)(event('GET', '/api/courses/CS%20310'));
    expect(res.statusCode).toBe(200);
    expect(deps.catalog.getCourse).toHaveBeenCalledWith('CS310');
  });

  test('shows a catalog course that has no syllabi yet', async () => {
    const res = await createApp(fakes())(event('GET', '/api/courses/MATH113'));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toMatchObject({ code: 'MATH113', title: 'Analytic Geometry and Calculus I', credits: '4', offerings: [] });
  });

  test("lists schools, and one school's departments", async () => {
    const deps = fakes();
    expect(parse(await createApp(deps)(event('GET', '/api/schools'))).schools.map((s) => s.key)).toEqual(['gmu', 'unc']);
    const res = await createApp(deps)(event('GET', '/api/departments', { query: { school: 'unc' } }));
    expect(res.statusCode).toBe(200);
    expect(deps.departments.list).toHaveBeenCalledWith('unc');
    expect((await createApp(deps)(event('GET', '/api/departments', { query: { school: 'nope' } }))).statusCode).toBe(404);
  });

  test("lists another school's department by bare code or full key", async () => {
    const deps = fakes();
    deps.catalog.listCourses.mockResolvedValue([]);
    const bare = await createApp(deps)(event('GET', '/api/courses', { query: { school: 'unc', dept: 'comp' } }));
    expect(bare.statusCode).toBe(200);
    expect(parse(bare)).toMatchObject({ dept: 'unc:COMP', display: 'COMP', school: 'unc' });
    expect(deps.catalog.listCourses).toHaveBeenCalledWith('unc:COMP');
    const full = await createApp(deps)(event('GET', '/api/courses', { query: { dept: 'unc:COMP' } }));
    expect(parse(full).dept).toBe('unc:COMP');
    // GMU's CS is not UNC's.
    const wrong = await createApp(deps)(event('GET', '/api/courses', { query: { school: 'unc', dept: 'CS' } }));
    expect(wrong.statusCode).toBe(404);
    expect(parse(wrong).error).toBe("CS isn't a department at UNC");
  });

  test('course search and full-text search stay inside the chosen school', async () => {
    const deps = fakes();
    await createApp(deps)(event('GET', '/api/courses', { query: { q: 'calc', school: 'unc' } }));
    expect(deps.departments.search).toHaveBeenCalledWith('calc', 'unc');
    await createApp(deps)(event('GET', '/api/search', { query: { q: 'java', school: 'unc' } }));
    expect(deps.search.search).toHaveBeenCalledWith('java', 'unc');
  });

  test("a course page says which school it's from", async () => {
    const deps = fakes();
    deps.catalog.getCourse.mockResolvedValue({ code: 'unc:COMP110', title: 'Intro', offerings: [] });
    const res = await createApp(deps)(event('GET', '/api/courses/unc%3ACOMP%20110'));
    expect(res.statusCode).toBe(200);
    expect(deps.catalog.getCourse).toHaveBeenCalledWith('unc:COMP110');
    expect(parse(res)).toMatchObject({ school: 'unc', dept: 'unc:COMP' });
  });

  test('professors are listed per school', async () => {
    const deps = fakes();
    deps.catalog.listOfferings = jest.fn().mockResolvedValue([
      { code: 'CS310', termKey: '2024-3', section: '001', instructors: ['Smith, J'], fileId: FILE_ID },
      { code: 'unc:COMP110', termKey: '2024-3', section: '001', instructors: ['Smith, J'], fileId: 'b'.repeat(24) },
    ]);
    const gmu = parse(await createApp(deps)(event('GET', '/api/professors')));
    const unc = parse(await createApp(deps)(event('GET', '/api/professors', { query: { school: 'unc' } })));
    expect(gmu.professors[0].courses).toEqual(['CS310']);
    expect(unc.professors[0].courses).toEqual(['unc:COMP110']);
  });

  test('404s for unknown courses', async () => {
    const res = await createApp(fakes())(event('GET', '/api/courses/CS999'));
    expect(res.statusCode).toBe(404);
  });

  test('lists professors with their courses', async () => {
    const deps = fakes();
    deps.catalog.listOfferings = jest.fn().mockResolvedValue([
      { code: 'CS310', termKey: '2024-3', section: '001', instructors: ['Ada Lovelace'], fileId: FILE_ID },
    ]);
    const res = await createApp(deps)(event('GET', '/api/professors'));
    expect(res.statusCode).toBe(200);
    expect(parse(res).professors).toEqual([
      expect.objectContaining({ name: 'Ada Lovelace', slug: 'ada-lovelace', courses: ['CS310'] }),
    ]);
  });

  test('searches inside syllabi', async () => {
    const deps = fakes();
    deps.search = { search: jest.fn().mockResolvedValue([{ fileId: FILE_ID, codes: ['CS310'], snippet: 'uses Java' }]) };
    const res = await createApp(deps)(event('GET', '/api/search', { query: { q: ' java ' } }));
    expect(res.statusCode).toBe(200);
    expect(deps.search.search).toHaveBeenCalledWith('java', 'gmu');
    expect(parse(res).results).toHaveLength(1);
  });

  test('rejects searches that are too short or too long', async () => {
    const app = createApp({ ...fakes(), search: { search: jest.fn() } });
    expect((await app(event('GET', '/api/search', { query: { q: 'a' } }))).statusCode).toBe(400);
    expect((await app(event('GET', '/api/search', { query: { q: 'x'.repeat(101) } }))).statusCode).toBe(400);
  });

  test('serves a syllabus file as base64', async () => {
    const res = await createApp(fakes())(event('GET', `/api/syllabi/${FILE_ID}`));
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBe(true);
    expect(Buffer.from(res.body, 'base64').equals(PDF)).toBe(true);
  });

  test('sandboxes HTML syllabi', async () => {
    const deps = fakes();
    deps.files.read.mockResolvedValue({ buffer: Buffer.from('<p>hi</p>'), contentType: 'text/html', filename: 'a.html' });
    const res = await createApp(deps)(event('GET', `/api/syllabi/${FILE_ID}`));
    expect(res.headers['Content-Security-Policy']).toMatch(/sandbox/);
  });
});

describe('uploads', () => {
  const query = { course: 'CS 310', term: 'Fall 2024', section: '001', instructor: 'Ada Lovelace' };

  // Uploads are parsed, so these tests need a real PDF.
  let realPdf;
  beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText('CS 310 Fall 2024');
    realPdf = Buffer.from(await doc.save());
  });

  test('stores a valid PDF as pending', async () => {
    const deps = fakes();
    const res = await createApp(deps)(event('POST', '/api/uploads', { query, body: realPdf }));
    expect(res.statusCode).toBe(201);
    expect(deps.files.save).toHaveBeenCalledWith('pending', expect.any(Buffer), expect.any(Object));
    expect(deps.uploads.create).toHaveBeenCalledWith(
      expect.objectContaining({
        course_code: 'CS310',
        term_key: '2024-3',
        detected: {
          courseCodes: ['CS310'],
          fileCheck: { status: 'clean', pages: 1, removed: [] },
          virusScan: { status: 'not-scanned' },
          ai: AI,
        },
      })
    );
    expect(deps.readText).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf');
    expect(deps.checkUpload).toHaveBeenCalledWith(
      'CS 310 syllabus text',
      { course: 'CS 310', title: 'Data Structures', term: 'Fall 2024', section: '001', instructor: 'Ada Lovelace' },
      { duplicates: [] }
    );
  });

  test('tells the AI check about a syllabus already on the site', async () => {
    const deps = fakes();
    deps.catalog.getCourse.mockResolvedValue({
      title: 'Data Structures',
      offerings: [
        { termKey: '2024-3', section: '001', instructors: ['Lovelace, Ada'] },
        { termKey: '2024-3', section: '002', instructors: ['Babbage, C'] },
        { termKey: '2023-3', section: '001', instructors: ['Lovelace, Ada'] },
      ],
    });
    await createApp(deps)(event('POST', '/api/uploads', { query, body: realPdf }));
    expect(deps.checkUpload.mock.calls[0][2]).toEqual({ duplicates: [{ section: '001', instructors: ['Lovelace, Ada'] }] });
  });

  test('a failing AI check never fails the upload', async () => {
    const deps = fakes();
    deps.readText.mockRejectedValue(new Error('bad font'));
    deps.checkUpload.mockRejectedValue(new Error('boom'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await createApp(deps)(event('POST', '/api/uploads', { query, body: realPdf }));
    console.error.mockRestore();
    expect(res.statusCode).toBe(201);
    expect(deps.uploads.create.mock.calls[0][0].detected.ai.unavailable).toBe('The AI check failed.');
  });

  test('refuses a file the virus scanner flags and stores nothing', async () => {
    const deps = fakes();
    deps.virusScan.mockResolvedValue({ status: 'infected', signature: 'Eicar-Test-Signature' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await createApp(deps)(event('POST', '/api/uploads', { query, body: realPdf }));
    console.error.mockRestore();
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error).toMatch(/virus scanner/);
    expect(deps.virusScan).toHaveBeenCalledWith(realPdf);
    expect(deps.files.save).not.toHaveBeenCalled();
    expect(deps.uploads.create).not.toHaveBeenCalled();
  });

  test('refuses a PDF that cannot be read and stores nothing', async () => {
    const deps = fakes();
    const res = await createApp(deps)(event('POST', '/api/uploads', { query, body: PDF }));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error).toMatch(/couldn't be read/);
    expect(deps.files.save).not.toHaveBeenCalled();
  });

  test('rejects files that are not PDFs or HTML pages', async () => {
    const app = createApp(fakes());
    expect((await app(event('POST', '/api/uploads', { query, body: 'hello' }))).statusCode).toBe(415);
    expect((await app(event('POST', '/api/uploads', { query, body: 'PK\x03\x04 docx' }))).statusCode).toBe(415);
  });

  test('accepts an HTML syllabus and skips the PDF reader', async () => {
    const deps = fakes();
    const html = '﻿<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN">\n<html><title>CS483</title></html>';
    const res = await createApp(deps)(event('POST', '/api/uploads', { query, body: html }));
    expect(res.statusCode).toBe(201);
    expect(deps.files.save).toHaveBeenCalledWith(
      'pending',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'text/html; charset=utf-8', filename: 'CS310_2024-3_001.html' })
    );
    expect(deps.analyze).not.toHaveBeenCalled();
    expect(deps.uploads.create).toHaveBeenCalledWith(expect.objectContaining({ detected: { fileCheck: { status: 'html' }, virusScan: { status: 'not-scanned' }, ai: AI } }));
    expect(deps.readText).toHaveBeenCalledWith(expect.any(Buffer), 'text/html; charset=utf-8');
  });

  test('rejects bad course details', async () => {
    const res = await createApp(fakes())(event('POST', '/api/uploads', { query: { ...query, term: 'Winter 2024' }, body: PDF }));
    expect(res.statusCode).toBe(400);
  });

  test("an upload for another school keeps the school in its course code", async () => {
    const deps = fakes();
    const res = await createApp(deps)(event('POST', '/api/uploads', { query: { ...query, course: 'COMP 110', school: 'unc' }, body: realPdf }));
    expect(res.statusCode).toBe(201);
    expect(deps.uploads.create).toHaveBeenCalledWith(expect.objectContaining({ course_code: 'unc:COMP110' }));
  });

  test('takes uploads for any GMU department, not made-up ones', async () => {
    const deps = fakes();
    const math = await createApp(deps)(event('POST', '/api/uploads', { query: { ...query, course: 'MATH 113' }, body: realPdf }));
    expect(math.statusCode).toBe(201);
    const made = await createApp(deps)(event('POST', '/api/uploads', { query: { ...query, course: 'XYZ 113' }, body: realPdf }));
    expect(made.statusCode).toBe(400);
    expect(parse(made).error).toMatch(/XYZ isn't a department at GMU/);
  });

  test('rate limits by IP', async () => {
    const deps = fakes();
    deps.catalog.hitRateLimit.mockResolvedValue(false);
    const res = await createApp(deps)(event('POST', '/api/uploads', { query, body: realPdf }));
    expect(res.statusCode).toBe(429);
    expect(deps.files.save).not.toHaveBeenCalled();
  });
});

describe('admin', () => {
  const auth = (token) => ({ authorization: `Bearer ${token}` });

  test('requires a signed-in admin', async () => {
    const app = createApp(fakes());
    expect((await app(event('GET', '/api/admin/uploads'))).statusCode).toBe(401);
    expect((await app(event('GET', '/api/admin/uploads', { headers: auth('bad') }))).statusCode).toBe(403);
    expect((await app(event('GET', '/api/admin/uploads', { headers: auth('good') }))).statusCode).toBe(200);
  });

  test('runs the AI check again with the details on the card and saves it', async () => {
    const deps = fakes();
    const body = JSON.stringify({ course: 'CS 483', term: 'Spring 2024', section: '002', instructor: 'Ada Lovelace' });
    const res = await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/ai-check`, { headers: auth('good'), body }));
    expect(res.statusCode).toBe(200);
    expect(deps.files.read).toHaveBeenCalledWith('pending', FILE_ID);
    expect(deps.checkUpload.mock.calls[0][1]).toMatchObject({ course: 'CS 483', term: 'Spring 2024', section: '002' });
    expect(deps.uploads.saveDetected).toHaveBeenCalledWith(UPLOAD_ID, { ai: AI });
    expect(parse(res).detected.ai).toEqual(AI);
  });

  test('the AI check route is for admins and pending uploads only', async () => {
    const deps = fakes();
    const app = createApp(deps);
    expect((await app(event('POST', `/api/admin/uploads/${UPLOAD_ID}/ai-check`))).statusCode).toBe(401);
    deps.uploads.get.mockResolvedValue({ id: UPLOAD_ID, status: 'approved' });
    expect((await app(event('POST', `/api/admin/uploads/${UPLOAD_ID}/ai-check`, { headers: auth('good') }))).statusCode).toBe(409);
    expect(deps.checkUpload).not.toHaveBeenCalled();
  });

  test('approving publishes the file and the offering', async () => {
    const deps = fakes();
    const res = await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good') }));
    expect(res.statusCode).toBe(200);
    expect(deps.files.move).toHaveBeenCalledWith('pending', 'syllabi', FILE_ID);
    expect(deps.catalog.putOffering).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CS310', title: 'Data Structures', term: expect.objectContaining({ key: '2024-3' }) })
    );
    expect(deps.uploads.review).toHaveBeenCalledWith(UPLOAD_ID, { status: 'approved', reviewer: 'admin@gmu.edu' });
    expect(deps.catalog.markUploaded).toHaveBeenCalledTimes(1);
    expect(deps.files.read).toHaveBeenCalledWith('syllabi', FILE_ID);
    expect(deps.summarize).toHaveBeenCalledWith('CS 310 syllabus text', { timeoutMs: 7000 });
    expect(deps.catalog.putSummary).toHaveBeenCalledWith(FILE_ID, SUMMARY_RESULT);
    expect(parse(res).summary).toBe('saved');
  });

  test('an upload the virus scan flagged cannot be approved', async () => {
    const deps = fakes();
    deps.uploads.get.mockResolvedValue({
      ...(await deps.uploads.get()),
      detected: { virusScan: { status: 'infected', signature: 'Eicar-Test-Signature' } },
    });
    const res = await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good') }));
    expect(res.statusCode).toBe(409);
    expect(deps.files.move).not.toHaveBeenCalled();
  });

  test('approving still works when the summary fails', async () => {
    const deps = fakes();
    deps.summarize.mockResolvedValue({ unavailable: 'Gemini timed out.' });
    deps.catalog.putSummary.mockRejectedValue(new Error('not called'));
    const res = await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good') }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).summary).toEqual({ unavailable: 'Gemini timed out.' });
    expect(deps.catalog.putSummary).not.toHaveBeenCalled();

    deps.summarize.mockRejectedValue(new Error('boom'));
    const again = await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good') }));
    expect(again.statusCode).toBe(200);
  });

  test('approving can correct the details the student entered', async () => {
    const deps = fakes();
    const body = JSON.stringify({ course: 'cs 584', term: 'Fall 2026', section: '004', instructor: 'Zhu, Z' });
    const res = await createApp(deps)(
      event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good'), body })
    );
    expect(res.statusCode).toBe(200);
    expect(deps.catalog.putOffering).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CS584', section: '004', instructors: ['Zhu, Z'], term: expect.objectContaining({ key: '2026-3' }) })
    );
    expect(deps.uploads.review).toHaveBeenCalledWith(
      UPLOAD_ID,
      expect.objectContaining({ changes: { course_code: 'CS584', term_key: '2026-3', section: '004', instructor: 'Zhu, Z' } })
    );
  });

  test('approving can list several professors separated by ";"', async () => {
    const deps = fakes();
    const body = JSON.stringify({ instructor: 'Andrea, Kevin; Kongmunvattana, Angkul ; Zhong, Yutao' });
    const res = await createApp(deps)(
      event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good'), body })
    );
    expect(res.statusCode).toBe(200);
    expect(deps.catalog.putOffering).toHaveBeenCalledWith(
      expect.objectContaining({ instructors: ['Andrea, Kevin', 'Kongmunvattana, Angkul', 'Zhong, Yutao'] })
    );
    expect(deps.uploads.review).toHaveBeenCalledWith(
      UPLOAD_ID,
      expect.objectContaining({
        changes: expect.objectContaining({ instructor: 'Andrea, Kevin; Kongmunvattana, Angkul; Zhong, Yutao' }),
      })
    );

    const bad = await createApp(fakes())(
      event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good'), body: '{"instructor":"Andrea, Kevin; 1"}' })
    );
    expect(bad.statusCode).toBe(400);
  });

  test('approving rejects invalid corrections before publishing', async () => {
    const deps = fakes();
    const res = await createApp(deps)(
      event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good'), body: '{"course":"XYZ 213"}' })
    );
    expect(res.statusCode).toBe(400);
    expect(deps.files.move).not.toHaveBeenCalled();
  });

  test('a new course needs a title before approval', async () => {
    const deps = fakes();
    deps.catalog.getCourseMeta.mockResolvedValue(null);
    const res = await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good') }));
    expect(res.statusCode).toBe(400);
    expect(deps.files.move).not.toHaveBeenCalled();
  });

  test("an admin's bare course code is read at the upload's own school", async () => {
    const deps = fakes();
    deps.uploads.get.mockResolvedValue({ id: UPLOAD_ID, status: 'pending', course_code: 'unc:COMP110', term_key: '2024-3', section: '001', instructor: 'Smith, J', file_id: FILE_ID });
    const body = JSON.stringify({ course: 'COMP 110', title: 'Intro to Programming' });
    const res = await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good'), body }));
    expect(res.statusCode).toBe(200);
    expect(deps.catalog.putOffering).toHaveBeenCalledWith(expect.objectContaining({ dept: 'unc:COMP', code: 'unc:COMP110' }));
  });

  test("a catalog course's first syllabus takes the catalog title and counts for its department", async () => {
    const deps = fakes();
    deps.catalog.getCourseMeta.mockResolvedValue(null);
    deps.catalog.putOffering.mockResolvedValue({ firstSyllabus: true });
    const body = JSON.stringify({ course: 'MATH 113' });
    const res = await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good'), body }));
    expect(res.statusCode).toBe(200);
    expect(deps.catalog.putOffering).toHaveBeenCalledWith(
      expect.objectContaining({ dept: 'MATH', code: 'MATH113', title: 'Analytic Geometry and Calculus I' })
    );
    expect(deps.departments.addCourseWithSyllabi).toHaveBeenCalledWith('MATH');
  });

  test('approving an HTML upload keeps its type', async () => {
    const deps = fakes();
    deps.files.move.mockResolvedValue({ id: FILE_ID, contentType: 'text/html; charset=utf-8' });
    await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good') }));
    expect(deps.catalog.putOffering).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'text/html; charset=utf-8' }));
  });

  test('pending HTML is served sandboxed to the admin', async () => {
    const deps = fakes();
    deps.files.read.mockResolvedValue({ buffer: Buffer.from('<html></html>'), contentType: 'text/html; charset=utf-8' });
    const res = await createApp(deps)(event('GET', `/api/admin/uploads/${UPLOAD_ID}/file`, { headers: auth('good') }));
    expect(res.headers['Content-Security-Policy']).toMatch(/^sandbox/);
  });

  test('pending PDFs are served inline, sandboxed and unsniffed', async () => {
    const deps = fakes();
    deps.files.read.mockResolvedValue({ buffer: Buffer.from('%PDF-1.7'), filename: 'CS310_2026-3_"001".pdf', contentType: 'application/pdf' });
    const res = await createApp(deps)(event('GET', `/api/admin/uploads/${UPLOAD_ID}/file`, { headers: auth('good') }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Disposition']).toBe('inline; filename="CS310_2026-3_001.pdf"');
    expect(res.headers['Content-Security-Policy']).toMatch(/^sandbox/);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  test('rejecting deletes the pending file', async () => {
    const deps = fakes();
    const res = await createApp(deps)(
      event('POST', `/api/admin/uploads/${UPLOAD_ID}/reject`, { headers: auth('good'), body: '{"note":"blurry"}' })
    );
    expect(res.statusCode).toBe(200);
    expect(deps.files.remove).toHaveBeenCalledWith('pending', FILE_ID);
  });
});

describe('admin fixes to published syllabi', () => {
  const auth = { authorization: 'Bearer good' };
  const post = (path, body, headers = auth) => event('POST', path, { headers, body: JSON.stringify(body) });

  test('need a signed-in admin', async () => {
    const deps = fakes();
    const app = createApp(deps);
    expect((await app(post('/api/admin/offerings/update', { code: 'CS580', id: OFFERING.SK }, {}))).statusCode).toBe(401);
    expect((await app(post('/api/admin/offerings/delete', { code: 'CS580', id: OFFERING.SK }, {}))).statusCode).toBe(401);
    expect((await app(event('GET', '/api/admin/courses/CS310'))).statusCode).toBe(401);
    expect(deps.catalog.deleteOffering).not.toHaveBeenCalled();
  });

  test('lists a course without caching', async () => {
    const res = await createApp(fakes())(event('GET', '/api/admin/courses/CS%20310', { headers: auth }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  test('moves a syllabus to another course and remembers the fix', async () => {
    const deps = fakes();
    deps.catalog.getCourseMeta.mockResolvedValue({ title: 'Data Mining' });
    const res = await createApp(deps)(
      post('/api/admin/offerings/update', { code: 'CS580', id: OFFERING.SK, course: 'CS 584', instructors: 'Zhu, Z; Yu, F' })
    );
    expect(res.statusCode).toBe(200);
    expect(deps.catalog.updateOffering).toHaveBeenCalledWith(
      expect.objectContaining({ SK: OFFERING.SK }),
      expect.objectContaining({ code: 'CS584', title: 'Data Mining', section: '001', instructors: ['Zhu, Z', 'Yu, F'] })
    );
    expect(deps.catalog.markCurated).toHaveBeenCalledWith(OFFERING.sourceUrl, { action: 'edited', by: 'admin@gmu.edu' });
    expect(deps.search.refresh).toHaveBeenCalledWith(FILE_ID, []);
  });

  test('moving to a course not on the site needs a title', async () => {
    const deps = fakes();
    deps.catalog.getCourseMeta.mockResolvedValue(null);
    const res = await createApp(deps)(post('/api/admin/offerings/update', { code: 'CS580', id: OFFERING.SK, course: 'CS 799' }));
    expect(res.statusCode).toBe(400);
    expect(deps.catalog.updateOffering).not.toHaveBeenCalled();
  });

  test('404s for a syllabus that does not exist', async () => {
    const res = await createApp(fakes())(post('/api/admin/offerings/update', { code: 'CS580', id: 'TERM#nope' }));
    expect(res.statusCode).toBe(404);
  });

  test('deleting removes the file once nothing points at it', async () => {
    const deps = fakes();
    const res = await createApp(deps)(post('/api/admin/offerings/delete', { code: 'CS580', id: OFFERING.SK }));
    expect(res.statusCode).toBe(200);
    expect(deps.catalog.markCurated).toHaveBeenCalledWith(OFFERING.sourceUrl, { action: 'deleted', by: 'admin@gmu.edu' });
    expect(deps.catalog.deleteOffering).toHaveBeenCalledWith(expect.objectContaining({ SK: OFFERING.SK }));
    expect(deps.files.remove).toHaveBeenCalledWith('syllabi', FILE_ID);
    expect(deps.catalog.deleteSummary).toHaveBeenCalledWith(FILE_ID);
  });

  test('an admin can edit a summary, and the edit is cleaned and signed', async () => {
    const deps = fakes();
    deps.catalog.offeringsForFile.mockResolvedValue([OFFERING]);
    deps.catalog.getSummaries.mockResolvedValue(new Map([[FILE_ID, SUMMARY_RESULT]]));
    const summary = { overview: ' Fixed. ', topics: ['Graphs'], extra: 'x' };
    const res = await createApp(deps)(post(`/api/admin/summaries/${FILE_ID}`, { summary }));
    expect(res.statusCode).toBe(200);
    const [fileId, record] = deps.catalog.putSummary.mock.calls[0];
    expect(fileId).toBe(FILE_ID);
    expect(record).toMatchObject({ model: 'gemini-3.5-flash-lite', editedBy: 'admin@gmu.edu' });
    expect(record.summary).toMatchObject({ overview: 'Fixed.', topics: ['Graphs'], tools: [] });
    expect(record.summary).not.toHaveProperty('extra');
  });

  test('an empty summary, an unknown file or a non-admin is turned away', async () => {
    const deps = fakes();
    const app = createApp(deps);
    expect((await app(post(`/api/admin/summaries/${FILE_ID}`, { summary: {} }))).statusCode).toBe(404);
    deps.catalog.offeringsForFile.mockResolvedValue([OFFERING]);
    expect((await app(post(`/api/admin/summaries/${FILE_ID}`, { summary: { overview: ' ' } }))).statusCode).toBe(400);
    expect((await app(post(`/api/admin/summaries/${FILE_ID}/regenerate`, {}, {}))).statusCode).toBe(401);
    expect(deps.catalog.putSummary).not.toHaveBeenCalled();
  });

  test('regenerating asks the AI again, and says when it cannot', async () => {
    const deps = fakes();
    deps.catalog.offeringsForFile.mockResolvedValue([OFFERING]);
    const app = createApp(deps);
    const res = await app(post(`/api/admin/summaries/${FILE_ID}/regenerate`, {}));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual(SUMMARY_RESULT);
    expect(deps.catalog.putSummary).toHaveBeenCalledWith(FILE_ID, SUMMARY_RESULT);

    deps.summarize.mockResolvedValue({ unavailable: 'Gemini free quota used up.' });
    const failed = await app(post(`/api/admin/summaries/${FILE_ID}/regenerate`, {}));
    expect(failed.statusCode).toBe(503);
    expect(parse(failed).error).toMatch(/quota/);
  });

  test('deleting an HTML syllabus also deletes its PDF copy', async () => {
    const deps = fakes();
    const PDF_COPY = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    deps.catalog.getOffering.mockResolvedValue({ ...OFFERING, pdfFileId: PDF_COPY });
    await createApp(deps)(post('/api/admin/offerings/delete', { code: 'CS580', id: OFFERING.SK }));
    expect(deps.files.remove).toHaveBeenCalledWith('syllabi', PDF_COPY);
  });

  test('deleting keeps a file another course still uses', async () => {
    const deps = fakes();
    deps.catalog.offeringsForFile.mockResolvedValue([{ ...OFFERING, code: 'CS584' }]);
    const res = await createApp(deps)(post('/api/admin/offerings/delete', { code: 'CS580', id: OFFERING.SK }));
    expect(parse(res)).toEqual({ deleted: true, fileDeleted: false });
    expect(deps.files.remove).not.toHaveBeenCalled();
  });
});

describe('admin professor merge', () => {
  const auth = { authorization: 'Bearer good' };
  const post = (body, headers = auth) =>
    event('POST', '/api/admin/professors/merge', { headers, body: JSON.stringify(body) });
  const withNames = () => {
    const deps = fakes();
    deps.catalog.listOfferings = jest.fn().mockResolvedValue([
      { code: 'CS580', display: 'CS 580', instructors: ['Gonzalez Hernandez, A'] },
      { code: 'CS584', display: 'CS 584', instructors: ['González, Ana', 'Zhu, Z'] },
      { code: 'CS580', display: 'CS 580', instructors: ['Gonzalez Hernandez, A'] },
    ]);
    deps.catalog.offeringsByInstructor = jest.fn().mockResolvedValue([
      { ...OFFERING, instructors: ['Gonzalez Hernandez, A'] },
    ]);
    return deps;
  };

  test('needs a signed-in admin', async () => {
    const deps = withNames();
    const app = createApp(deps);
    expect((await app(event('GET', '/api/admin/professors'))).statusCode).toBe(401);
    expect((await app(post({ from: 'Gonzalez Hernandez, A', into: 'González, Ana', apply: true }, {}))).statusCode).toBe(401);
    expect(deps.catalog.updateOffering).not.toHaveBeenCalled();
  });

  test('lists every stored spelling with its count and courses', async () => {
    const res = await createApp(withNames())(event('GET', '/api/admin/professors', { headers: auth }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(parse(res).professors).toEqual([
      { name: 'Gonzalez Hernandez, A', count: 2, courses: ['CS 580'] },
      { name: 'González, Ana', count: 1, courses: ['CS 584'] },
      { name: 'Zhu, Z', count: 1, courses: ['CS 584'] },
    ]);
  });

  test('a preview lists the changes and writes nothing', async () => {
    const deps = withNames();
    const res = await createApp(deps)(post({ from: 'Gonzalez Hernandez, A', into: 'González, Ana' }));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({
      applied: false,
      changes: [
        { code: 'CS580', term: 'Fall 2024', section: '001', before: ['Gonzalez Hernandez, A'], after: ['González, Ana'] },
      ],
    });
    expect(deps.catalog.updateOffering).not.toHaveBeenCalled();
    expect(deps.catalog.markCurated).not.toHaveBeenCalled();
  });

  test('applying rewrites each syllabus, remembers the fix and refreshes search', async () => {
    const deps = withNames();
    const res = await createApp(deps)(post({ from: 'Gonzalez Hernandez, A', into: 'González, Ana', apply: true }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).applied).toBe(true);
    expect(deps.catalog.updateOffering).toHaveBeenCalledWith(
      expect.objectContaining({ SK: OFFERING.SK }),
      expect.objectContaining({ code: 'CS580', instructors: ['González, Ana'] })
    );
    expect(deps.catalog.markCurated).toHaveBeenCalledWith(OFFERING.sourceUrl, { action: 'edited', by: 'admin@gmu.edu' });
    expect(deps.search.refresh).toHaveBeenCalledWith(FILE_ID, []);
  });

  test('rejects a blank or unchanged name and 404s for a name no syllabus lists', async () => {
    const deps = withNames();
    const app = createApp(deps);
    expect((await app(post({ from: '', into: 'González, Ana' }))).statusCode).toBe(400);
    expect((await app(post({ from: 'Zhu, Z', into: '' }))).statusCode).toBe(400);
    expect((await app(post({ from: 'Zhu, Z', into: 'Zhu, Z' }))).statusCode).toBe(400);
    deps.catalog.offeringsByInstructor.mockResolvedValue([]);
    const res = await app(post({ from: 'Nobody, N', into: 'Zhu, Z' }));
    expect(res.statusCode).toBe(404);
  });
});

describe('routing', () => {
  test('unknown paths 404 and wrong methods 405', async () => {
    const app = createApp(fakes());
    expect((await app(event('GET', '/api/nope'))).statusCode).toBe(404);
    expect((await app(event('DELETE', '/api/courses'))).statusCode).toBe(405);
  });

  test('health reports each store', async () => {
    const deps = fakes();
    deps.uploads.ping.mockRejectedValue(new Error('paused'));
    const res = await createApp(deps)(event('GET', '/api/health'));
    expect(res.statusCode).toBe(503);
    expect(parse(res)).toEqual({ dynamodb: 'ok', mongodb: 'ok', supabase: 'paused' });
  });
});

describe('admin refresh', () => {
  const auth = { authorization: 'Bearer good' };
  const withScrape = (run = null, enabled = true) => {
    const deps = fakes();
    deps.scrape = {
      enabled,
      latest: jest.fn().mockResolvedValue({ enabled, environment: 'staging', run }),
      start: jest.fn().mockResolvedValue(),
    };
    return deps;
  };

  test('needs a signed-in admin', async () => {
    const deps = withScrape();
    const app = createApp(deps);
    expect((await app(event('GET', '/api/admin/refresh'))).statusCode).toBe(401);
    expect((await app(event('POST', '/api/admin/refresh'))).statusCode).toBe(401);
    expect(deps.scrape.start).not.toHaveBeenCalled();
  });

  test('shows the latest run', async () => {
    const run = { status: 'completed', conclusion: 'success', running: false };
    const res = await createApp(withScrape(run))(event('GET', '/api/admin/refresh', { headers: auth }));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({ enabled: true, environment: 'staging', run });
  });

  test('starts a scrape', async () => {
    const deps = withScrape({ status: 'completed', running: false });
    const res = await createApp(deps)(event('POST', '/api/admin/refresh', { headers: auth }));
    expect(res.statusCode).toBe(202);
    expect(deps.scrape.start).toHaveBeenCalled();
  });

  test('refuses while a scrape is running', async () => {
    const deps = withScrape({ status: 'in_progress', running: true });
    const res = await createApp(deps)(event('POST', '/api/admin/refresh', { headers: auth }));
    expect(res.statusCode).toBe(409);
    expect(deps.scrape.start).not.toHaveBeenCalled();
  });

  test('says so when the token is not set', async () => {
    const res = await createApp(withScrape(null, false))(event('POST', '/api/admin/refresh', { headers: auth }));
    expect(res.statusCode).toBe(503);
  });

  test('turns GitHub errors into a 502', async () => {
    const deps = withScrape();
    deps.scrape.latest.mockRejectedValue(new Error('GitHub answered 401: Bad credentials'));
    const res = await createApp(deps)(event('GET', '/api/admin/refresh', { headers: auth }));
    expect(res.statusCode).toBe(502);
    expect(parse(res).error).toBe('GitHub answered 401: Bad credentials');
  });
});
