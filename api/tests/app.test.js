const { createApp } = require('../src/app');

const PDF = Buffer.from('%PDF-1.7\nfake syllabus');
const UPLOAD_ID = '11111111-2222-3333-4444-555555555555';
const FILE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

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
      hitRateLimit: jest.fn().mockResolvedValue(true),
      ping: jest.fn().mockResolvedValue(),
    },
    files: {
      save: jest.fn().mockResolvedValue(FILE_ID),
      read: jest.fn().mockResolvedValue({ buffer: PDF, contentType: 'application/pdf', filename: 'a.pdf' }),
      move: jest.fn().mockResolvedValue(FILE_ID),
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

  test('rejects files that are not PDFs', async () => {
    const res = await createApp(fakes())(event('POST', '/api/uploads', { query, body: 'hello' }));
    expect(res.statusCode).toBe(415);
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

  test('a new course needs a title before approval', async () => {
    const deps = fakes();
    deps.catalog.getCourseMeta.mockResolvedValue(null);
    const res = await createApp(deps)(event('POST', `/api/admin/uploads/${UPLOAD_ID}/approve`, { headers: auth('good') }));
    expect(res.statusCode).toBe(400);
    expect(deps.files.move).not.toHaveBeenCalled();
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
