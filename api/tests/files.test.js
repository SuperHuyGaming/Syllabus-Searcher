const { ObjectId } = require('mongodb');
const { createFiles, isAllowedLink, readFileBuffer, createR2Client } = require('../src/repos/files');
const { summarizeFile } = require('../src/lib/summary');

// A GridFS bucket stand-in holding { id: { filename, metadata, data } }.
function fakeBucket(files) {
  return {
    find: ({ _id }) => ({
      limit: () => ({
        toArray: async () => (files[_id.toHexString()] ? [{ _id, ...files[_id.toHexString()] }] : []),
      }),
    }),
    async *openDownloadStream(id) {
      yield files[id.toHexString()].data;
    },
    async delete(id) {
      if (!files[id.toHexString()]) throw new Error('FileNotFound: file not found');
      delete files[id.toHexString()];
    },
  };
}

// Each "database" is just the files of its syllabi bucket.
const makeBucket = (db) => fakeBucket(db);

describe('files across storage clusters', () => {
  const inMain = new ObjectId().toHexString();
  const inSecond = new ObjectId().toHexString();
  let main;
  let second;
  let files;

  beforeEach(() => {
    main = { [inMain]: { filename: 'a.pdf', metadata: { contentType: 'application/pdf' }, data: Buffer.from('main') } };
    second = { [inSecond]: { filename: 'b.pdf', metadata: { contentType: 'application/pdf' }, data: Buffer.from('two') } };
    files = createFiles({ db: main, pool: [second], makeBucket });
  });

  test('reads a file from whichever cluster has it', async () => {
    expect((await files.read('syllabi', inMain)).buffer.toString()).toBe('main');
    const other = await files.read('syllabi', inSecond);
    expect(other.buffer.toString()).toBe('two');
    expect(other.filename).toBe('b.pdf');
    expect(await files.read('syllabi', new ObjectId().toHexString())).toBeNull();
    expect(await files.read('syllabi', 'not-an-id')).toBeNull();
  });

  test('removes a file from the cluster that has it', async () => {
    await files.remove('syllabi', inSecond);
    expect(second[inSecond]).toBeUndefined();
    expect(main[inMain]).toBeDefined();
    await expect(files.remove('syllabi', new ObjectId().toHexString())).resolves.toBeUndefined();
  });

  test('works with the main cluster alone', async () => {
    const solo = createFiles({ db: main, pool: [], makeBucket });
    expect((await solo.read('syllabi', inMain)).buffer.toString()).toBe('main');
    expect(await solo.read('syllabi', inSecond)).toBeNull();
  });
});

describe('files in Supabase Storage', () => {
  const inSupabase = new ObjectId().toHexString();
  const inMain = new ObjectId().toHexString();

  function fakeStored() {
    const records = { [inSupabase]: { filename: 'c.pdf', metadata: { contentType: 'application/pdf', sourceUrl: 'x' } } };
    const objects = { [inSupabase]: Buffer.from('supabase') };
    return {
      records,
      objects,
      find: async (objectId) => records[objectId.toHexString()] || null,
      download: async (id) => objects[id] || null,
      async remove(objectId) {
        delete objects[objectId.toHexString()];
        delete records[objectId.toHexString()];
      },
    };
  }

  test('reads and removes a scraped file kept in Supabase Storage', async () => {
    const stored = fakeStored();
    const main = { [inMain]: { filename: 'a.pdf', metadata: {}, data: Buffer.from('main') } };
    const files = createFiles({ db: main, pool: [], makeBucket, stored });
    const file = await files.read('syllabi', inSupabase);
    expect(file.buffer.toString()).toBe('supabase');
    expect(file.contentType).toBe('application/pdf');
    expect((await files.read('syllabi', inMain)).buffer.toString()).toBe('main');
    // Uploads waiting for review are never in Supabase Storage.
    expect(await files.read('pending', inSupabase)).toBeNull();

    await files.remove('syllabi', inSupabase);
    expect(stored.records[inSupabase]).toBeUndefined();
    expect(stored.objects[inSupabase]).toBeUndefined();
  });

  test('a failed lookup reads as a missing file', async () => {
    const stored = { ...fakeStored(), find: async () => { throw new Error('down'); } };
    const files = createFiles({ db: {}, pool: [], makeBucket, stored });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await files.read('syllabi', inSupabase)).toBeNull();
    console.error.mockRestore();
  });
});

describe('link-only files', () => {
  const linkedId = new ObjectId().toHexString();
  const storedId = new ObjectId().toHexString();
  const LINK_URL = 'https://d101vc9winf8ln.cloudfront.net/syllabuses/12345/original/hist100.pdf';

  function fakeStoredWithLink() {
    const records = {
      [linkedId]: {
        _id: new ObjectId(linkedId),
        filename: 'hist100.pdf',
        length: 54321,
        metadata: { contentType: 'application/pdf', sourceUrl: LINK_URL },
        link: LINK_URL,
        uploadDate: new Date('2026-11-01T00:00:00Z'),
      },
      [storedId]: {
        _id: new ObjectId(storedId),
        filename: 'stored.pdf',
        length: 1234,
        metadata: { contentType: 'application/pdf', sourceUrl: 'https://cs.gmu.edu/a.pdf' },
      },
    };
    const objects = { [storedId]: Buffer.from('bytes') };
    const removeBlob = jest.fn((id) => {
      delete objects[id];
    });
    return {
      records,
      objects,
      removeBlob,
      find: jest.fn(async (objectId) => records[objectId.toHexString()] || null),
      findLinked: jest.fn(async (objectIds) =>
        objectIds.map((oid) => records[oid.toHexString()]).filter((doc) => doc && doc.link)
      ),
      download: jest.fn(async (id) => objects[id] || null),
      remove: jest.fn(async (objectId, { linkOnly = false } = {}) => {
        if (!linkOnly) removeBlob(objectId.toHexString());
        delete records[objectId.toHexString()];
      }),
    };
  }

  test('reads a linked file without downloading bytes', async () => {
    const stored = fakeStoredWithLink();
    const files = createFiles({ db: {}, pool: [], makeBucket, stored });
    const file = await files.read('syllabi', linkedId);
    expect(file).toEqual({
      link: LINK_URL,
      filename: 'hist100.pdf',
      contentType: 'application/pdf',
      metadata: { contentType: 'application/pdf', sourceUrl: LINK_URL },
    });
    expect(file.buffer).toBeUndefined();
    expect(stored.download).not.toHaveBeenCalled();
    expect(await files.read('pending', linkedId)).toBeNull();
  });

  test('removing a linked file deletes only the stored_files record, not blob storage', async () => {
    const stored = fakeStoredWithLink();
    const files = createFiles({ db: {}, pool: [], makeBucket, stored });
    await files.remove('syllabi', linkedId);
    expect(stored.records[linkedId]).toBeUndefined();
    expect(stored.remove).toHaveBeenCalledWith(new ObjectId(linkedId), { linkOnly: true });
    expect(stored.removeBlob).not.toHaveBeenCalled();

    // Removing a non-linked Supabase file still removes the blob.
    await files.remove('syllabi', storedId);
    expect(stored.remove).toHaveBeenCalledWith(new ObjectId(storedId), { linkOnly: false });
    expect(stored.removeBlob).toHaveBeenCalledWith(storedId);
  });

  test('linkedIds returns only the linked file ids and tolerates bad ids or errors', async () => {
    const stored = fakeStoredWithLink();
    const files = createFiles({ db: {}, pool: [], makeBucket, stored });
    const ids = await files.linkedIds([linkedId, storedId, linkedId, 'not-an-id', null, undefined]);
    expect([...ids]).toEqual([linkedId]);
    expect((await files.linkedIds([])).size).toBe(0);

    stored.findLinked.mockRejectedValueOnce(new Error('down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect((await files.linkedIds([linkedId])).size).toBe(0);
    console.error.mockRestore();
  });

  test('move returns null for a linked record with no buffer', async () => {
    const stored = fakeStoredWithLink();
    const files = createFiles({ db: {}, pool: [], makeBucket, stored });
    jest.spyOn(files, 'read').mockResolvedValueOnce({ link: LINK_URL, filename: 'hist100.pdf', contentType: 'application/pdf' });
    expect(await files.move('pending', 'syllabi', linkedId)).toBeNull();
  });
});

describe('isAllowedLink host allowlist', () => {
  test.each([
    'https://d101vc9winf8ln.cloudfront.net/syllabuses/12345/original/hist100.pdf',
    'https://D101VC9WINF8LN.CLOUDFRONT.NET/syllabuses/1/original/a.pdf',
    'https://files.bentruong.dev/64a1b2c3d4e5f6a7b8c9d0e1.pdf',
    'https://FILES.BENTRUONG.DEV/64a1b2c3d4e5f6a7b8c9d0e1.pdf',
    'https://web.archive.org/web/20250101000000id_/https://cs.gmu.edu/syllabus.pdf',
    'https://WEB.ARCHIVE.ORG/web/20250101000000id_/https://cs.gmu.edu/syllabus.pdf',
    'https://gmu.edu/syllabus.pdf',
    'https://historyarthistory.gmu.edu/course_sections/123.pdf',
    'https://masonkorea.gmu.edu/syllabi/test.pdf',
    'https://sub.dept.gmu.edu/path/file.pdf?v=1',
  ])('allows %s', (url) => {
    expect(isAllowedLink(url)).toBe(true);
  });

  test.each([
    'http://d101vc9winf8ln.cloudfront.net/syllabuses/1/original/a.pdf',
    'http://files.bentruong.dev/64a1b2c3d4e5f6a7b8c9d0e1.pdf',
    'http://web.archive.org/web/20250101000000id_/https://cs.gmu.edu/a.pdf',
    'https://sub.files.bentruong.dev/a.pdf',
    'https://files.bentruong.dev.evil.com/a.pdf',
    'https://sub.web.archive.org/a.pdf',
    'https://web.archive.org.evil.com/a.pdf',
    'http://historyarthistory.gmu.edu/a.pdf',
    'https://evilgmu.edu/a.pdf',
    'https://gmu.edu.evil.com/a.pdf',
    'https://sub.d101vc9winf8ln.cloudfront.net/a.pdf',
    'https://other.cloudfront.net/a.pdf',
    'https://.gmu.edu/a.pdf',
    'https://gmu.edu./a.pdf',
    'https://evil.com@gmu.edu/a.pdf',
    'https://gmu.edu:8443/a.pdf',
    'javascript:alert(1)',
    '//gmu.edu/a.pdf',
    'https://gmu.edu/a.pdf\r\nX-Injected: 1',
    ' https://gmu.edu/a.pdf',
    '',
    null,
    undefined,
    'not-a-url',
  ])('rejects %p', (url) => {
    expect(isAllowedLink(url)).toBe(false);
  });
});

describe('Cloudflare R2 stored files', () => {
  const r2Id = new ObjectId().toHexString();
  const linkedId = new ObjectId().toHexString();
  const R2_LINK = `https://files.bentruong.dev/${r2Id}.pdf`;
  const EXT_LINK = 'https://d101vc9winf8ln.cloudfront.net/syllabuses/1/original/a.pdf';

  function fakeStoredWithR2() {
    const records = {
      [r2Id]: {
        _id: new ObjectId(r2Id),
        filename: 'cs310.pdf',
        length: 4096,
        storage: 'r2',
        link: R2_LINK,
        metadata: { contentType: 'application/pdf', sourceUrl: 'https://cs.gmu.edu/cs310.pdf' },
      },
      [linkedId]: {
        _id: new ObjectId(linkedId),
        filename: 'hist100.pdf',
        length: 2048,
        link: EXT_LINK,
        metadata: { contentType: 'application/pdf', sourceUrl: EXT_LINK },
      },
    };
    const removeBlob = jest.fn();
    return {
      records,
      removeBlob,
      find: jest.fn(async (objectId) => records[objectId.toHexString()] || null),
      findLinked: jest.fn(async (objectIds) =>
        objectIds.map((oid) => records[oid.toHexString()]).filter((doc) => doc && doc.link)
      ),
      download: jest.fn(async () => null),
      remove: jest.fn(async (objectId, { linkOnly = false } = {}) => {
        if (!linkOnly) removeBlob(objectId.toHexString());
        delete records[objectId.toHexString()];
      }),
    };
  }

  test('reads R2 record as a redirect link and excludes it from external linkedIds', async () => {
    const stored = fakeStoredWithR2();
    const files = createFiles({ db: {}, pool: [], makeBucket, stored, r2: null });

    const file = await files.read('syllabi', r2Id);
    expect(file).toEqual({
      link: R2_LINK,
      storage: 'r2',
      filename: 'cs310.pdf',
      contentType: 'application/pdf',
      metadata: { contentType: 'application/pdf', sourceUrl: 'https://cs.gmu.edu/cs310.pdf' },
    });
    expect(stored.download).not.toHaveBeenCalled();

    const linked = await files.linkedIds([r2Id, linkedId]);
    expect([...linked]).toEqual([linkedId]);
  });

  test('removing an R2 record deletes the R2 object when credentials are configured', async () => {
    const stored = fakeStoredWithR2();
    const r2 = { deleteObject: jest.fn(async () => {}) };
    const files = createFiles({ db: {}, pool: [], makeBucket, stored, r2 });

    await files.remove('syllabi', r2Id);
    expect(r2.deleteObject).toHaveBeenCalledWith(`${r2Id}.pdf`);
    expect(stored.records[r2Id]).toBeUndefined();
    expect(stored.remove).toHaveBeenCalledWith(new ObjectId(r2Id), { linkOnly: true });
    expect(stored.removeBlob).not.toHaveBeenCalled();
  });

  test('removing an R2 record without R2 credentials removes only DB record and logs a message', async () => {
    const stored = fakeStoredWithR2();
    const files = createFiles({ db: {}, pool: [], makeBucket, stored, r2: null });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await files.remove('syllabi', r2Id);
    expect(stored.records[r2Id]).toBeUndefined();
    expect(stored.remove).toHaveBeenCalledWith(new ObjectId(r2Id), { linkOnly: true });
    expect(stored.removeBlob).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('R2 credentials not configured'));
    logSpy.mockRestore();
  });

  test('createR2Client requires all 4 env vars and signs S3 DELETE requests', async () => {
    const fullEnv = {
      R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      R2_ACCESS_KEY_ID: 'ak',
      R2_SECRET_ACCESS_KEY: 'sk',
      R2_BUCKET: 'syllabi-r2',
    };
    for (const key of Object.keys(fullEnv)) {
      const partial = { ...fullEnv, [key]: '  ' };
      expect(createR2Client(partial, jest.fn())).toBeNull();
    }

    const fetchFn = jest.fn(async () => ({ ok: true, status: 204 }));
    const client = createR2Client(fullEnv, fetchFn);
    expect(client).not.toBeNull();
    await client.deleteObject(`${r2Id}.pdf`, new Date('2026-11-28T12:00:00Z'));

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://acct.r2.cloudflarestorage.com/syllabi-r2/${r2Id}.pdf`);
    expect(init.method).toBe('DELETE');
    expect(init.headers['x-amz-date']).toBe('20261128T120000Z');
    expect(init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=ak\/20261128\/auto\/s3\/aws4_request/);
  });

  test('readFileBuffer and summarizeFile fetch R2 files via public link and skip external links', async () => {
    const pdfBytes = Buffer.from('%PDF-1.7 test syllabus');
    const fetchFn = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
    }));

    const r2File = { link: R2_LINK, storage: 'r2', contentType: 'application/pdf', filename: 'cs310.pdf' };
    const buf = await readFileBuffer(r2File, { fetchFn });
    expect(buf).toEqual(pdfBytes);
    expect(fetchFn).toHaveBeenCalledWith(R2_LINK);

    // External link-only files return null without fetching.
    const extFile = { link: EXT_LINK, contentType: 'application/pdf', filename: 'hist100.pdf' };
    expect(await readFileBuffer(extFile, { fetchFn })).toBeNull();

    // Disallowed R2 host is rejected without fetching.
    const badR2 = { link: 'https://evil.example.com/a.pdf', storage: 'r2', contentType: 'application/pdf' };
    expect(await readFileBuffer(badR2, { fetchFn })).toBeNull();

    // summarizeFile summarizes R2 files via public link.
    const catalog = { putSummary: jest.fn(async () => {}) };
    const files = { read: jest.fn(async () => r2File) };
    const readText = jest.fn(async () => 'CS 310 syllabus text');
    const summarize = jest.fn(async () => ({
      summary: 'Covers data structures.',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      generatedAt: '2026-11-28T12:00:00Z',
    }));

    const result = await summarizeFile({ catalog, files, fileId: r2Id, readText, summarize, fetchFn });
    expect(result.summary).toBe('Covers data structures.');
    expect(readText).toHaveBeenCalledWith(pdfBytes, 'application/pdf');
    expect(catalog.putSummary).toHaveBeenCalledTimes(1);

    // Failed R2 fetch returns unavailable gracefully.
    const failFetch = jest.fn(async () => ({ ok: false, status: 500 }));
    const failed = await summarizeFile({ catalog, files, fileId: r2Id, readText, summarize, fetchFn: failFetch });
    expect(failed.unavailable).toMatch(/R2/);
  });
});
