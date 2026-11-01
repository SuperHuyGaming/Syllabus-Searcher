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
      putOffering: jest.fn().mockResolvedValue(),
      getOffering: jest.fn(async (code, id) => (code === 'CS580' && id === OFFERING.SK ? { ...OFFERING } : null)),
      offeringsForFile: jest.fn().mockResolvedValue([]),
      updateOffering: jest.fn(async (old, next) => ({ ...old, PK: `COURSE#${next.code}`, SK: 'TERM#new', code: next.code })),
      deleteOffering: jest.fn().mockResolvedValue(),
      putCourse: jest.fn().mockResolvedValue(),
      markCurated: jest.fn().mockResolvedValue(),
      hitRateLimit: jest.fn().mockResolvedValue(true),
      ping: jest.fn().mockResolvedValue(),
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
      adminEmail: jest.fn(async (token) => (token === 'good' ? 'admin@gmu.edu' : null)),
      ping: jest.fn().mockResolvedValue(),
    },
    analyze: jest.fn().mockResolvedValue({ courseCodes: ['CS310'] }),
    search: { search: jest.fn(), refresh: jest.fn().mockResolvedValue() },
  };
}

const parse = (res) => JSON.parse(res.body);

describe('catalog routes', () => {
  test('lists CS courses sorted by code', async () => {
    const app = createApp(fakes());
    const res = await app(event('GET', '/api/courses'));
    expect(res.statusCode).toBe(200);
    expect(parse(res).courses.map((c) => c.code)).toEqual(['CS310', 'CS483']);
    expect(res.headers['Cache-Control']).toMatch(/s-maxage/);
  });

  test('rejects other departments for now', async () => {
    const res = await createApp(fakes())(event('GET', '/api/courses', { query: { dept: 'MATH' } }));
    expect(res.statusCode).toBe(400);
  });

  test('looks up a course with a spaced code', async () => {
    const deps = fakes();
    const res = await createApp(deps)(event('GET', '/api/courses/CS%20310'));
    expect(res.statusCode).toBe(200);
    expect(deps.catalog.getCourse).toHaveBeenCalledWith('CS310');
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
    expect(deps.search.search).toHaveBeenCalledWith('java');
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

  test('stores a valid PDF as pending', async () => {
    const deps = fakes();
    const res = await createApp(deps)(event('POST', '/api/uploads', { query, body: PDF }));
    expect(res.statusCode).toBe(201);
    expect(deps.files.save).toHaveBeenCalledWith('pending', expect.any(Buffer), expect.any(Object));
    expect(deps.uploads.create).toHaveBeenCalledWith(
      expect.objectContaining({ course_code: 'CS310', term_key: '2024-3', detected: { courseCodes: ['CS310'] } })
    );
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
    expect(deps.uploads.create).toHaveBeenCalledWith(expect.objectContaining({ detected: null }));
  });

  test('rejects bad course details', async () => {
    const res = await createApp(fakes())(event('POST', '/api/uploads', { query: { ...query, term: 'Winter 2024' }, body: PDF }));
    expect(res.statusCode).toBe(400);
  });

  test('rate limits by IP', async () => {
    const deps = fakes();
    deps.catalog.hitRateLimit.mockResolvedValue(false);
    const res = await createApp(deps)(event('POST', '/api/uploads', { query, body: PDF }));
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

  test('approving publishes the file and the offering', async () => {
    const deps = fakes();
    const res = await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good') }));
    expect(res.statusCode).toBe(200);
    expect(deps.files.move).toHaveBeenCalledWith('pending', 'syllabi', FILE_ID);
    expect(deps.catalog.putOffering).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CS310', title: 'Data Structures', term: expect.objectContaining({ key: '2024-3' }) })
    );
    expect(deps.uploads.review).toHaveBeenCalledWith(UPLOAD_ID, { status: 'approved', reviewer: 'admin@gmu.edu' });
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

  test('approving rejects invalid corrections before publishing', async () => {
    const deps = fakes();
    const res = await createApp(deps)(
      event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good'), body: '{"course":"MATH 213"}' })
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
