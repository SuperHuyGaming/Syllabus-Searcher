const { createCatalog } = require('../src/repos/catalog');

const record = (id) => ({ PK: 'SUMMARY', SK: id, summary: { overview: `About ${id}` }, provider: 'Gemini' });

// A fake DynamoDB client that answers by command name.
function fakeClient(answer) {
  return { send: jest.fn(async (command) => answer(command.constructor.name, command.input)) };
}

describe('summaries in the catalog', () => {
  test('reads summaries in batches and asks again for keys DynamoDB skipped', async () => {
    let calls = 0;
    const client = fakeClient((name, input) => {
      const keys = input.RequestItems.T.Keys;
      calls += 1;
      // The first answer leaves the last key unread, like a busy table can.
      if (calls === 1) {
        return { Responses: { T: keys.slice(0, -1).map((k) => record(k.SK)) }, UnprocessedKeys: { T: { Keys: keys.slice(-1) } } };
      }
      return { Responses: { T: keys.map((k) => record(k.SK)) } };
    });
    const catalog = createCatalog({ client, tableName: 'T' });
    const found = await catalog.getSummaries(['a', 'b', 'a', undefined]);
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(client.send.mock.calls[0][0].input.RequestItems.T.Keys).toEqual([
      { PK: 'SUMMARY', SK: 'a' },
      { PK: 'SUMMARY', SK: 'b' },
    ]);
    expect([...found.keys()]).toEqual(['a', 'b']);
    expect(found.get('b')).toEqual(expect.objectContaining({ summary: { overview: 'About b' }, provider: 'Gemini' }));
    expect(found.get('b')).not.toHaveProperty('PK');
  });

  test('asks for at most 100 keys at a time, and nothing for no files', async () => {
    const client = fakeClient((name, input) => ({ Responses: { T: input.RequestItems.T.Keys.map((k) => record(k.SK)) } }));
    const catalog = createCatalog({ client, tableName: 'T' });
    expect((await catalog.getSummaries([])).size).toBe(0);
    expect(client.send).not.toHaveBeenCalled();
    const ids = Array.from({ length: 150 }, (_, i) => `f${i}`);
    expect((await catalog.getSummaries(ids)).size).toBe(150);
    expect(client.send.mock.calls.map((c) => c[0].input.RequestItems.T.Keys.length)).toEqual([100, 50]);
  });

  test('a course lists each offering with its file’s summary', async () => {
    const client = fakeClient((name) => {
      if (name === 'QueryCommand') {
        return {
          Items: [
            { SK: 'META', title: 'Data Structures' },
            {
              SK: 'TERM#2024-3#SEC#001#a',
              termKey: '2024-3',
              section: '001',
              instructors: ['Ada'],
              fileId: 'a',
              source: 'gmu-cs',
              sourceUrl: 'https://cs.gmu.edu/media/syllabi/Fall2024/CS_310.pdf',
              createdAt: '2026-03-10T12:00:00Z',
            },
            { SK: 'TERM#2024-3#SEC#002#b', termKey: '2024-3', section: '002', instructors: ['Bo'], fileId: 'b' },
          ],
        };
      }
      return { Responses: { T: [record('a')] } };
    });
    const course = await createCatalog({ client, tableName: 'T' }).getCourse('CS310');
    expect(course.offerings[0].summary.summary.overview).toBe('About a');
    expect(course.offerings[0].sourceUrl).toBe('https://cs.gmu.edu/media/syllabi/Fall2024/CS_310.pdf');
    expect(course.offerings[0].createdAt).toBe('2026-03-10T12:00:00Z');
    expect(course.offerings[1].summary).toBeNull();
    expect(course.offerings[1]).not.toHaveProperty('sourceUrl');
    expect(course.rollup).toBeNull();
  });

  test('a course includes its rollup when there is one', async () => {
    const client = fakeClient((name, input) => {
      if (name === 'QueryCommand') return { Items: [{ SK: 'META', title: 'Data Structures' }] };
      if (name === 'GetCommand' && input.Key.PK === 'ROLLUP' && input.Key.SK === 'CS310') {
        return { Item: { PK: 'ROLLUP', SK: 'CS310', rollup: { overview: 'Usually trees.' }, provider: 'Gemini', fileIds: ['a', 'b'] } };
      }
      return {};
    });
    const course = await createCatalog({ client, tableName: 'T' }).getCourse('CS310');
    expect(course.rollup).toEqual(expect.objectContaining({ rollup: { overview: 'Usually trees.' }, provider: 'Gemini', fileIds: ['a', 'b'] }));
    expect(course.rollup).not.toHaveProperty('PK');
  });

  test('a course includes topic on special-topics offerings and omits it when absent', async () => {
    const client = fakeClient((name) => {
      if (name === 'QueryCommand') {
        return {
          Items: [
            { SK: 'META', title: 'Special Topics in Computer Science' },
            {
              SK: 'TERM#2026-3#SEC#001#a',
              termKey: '2026-3',
              termLabel: 'Fall 2026',
              section: '001',
              instructors: ['Ada'],
              topic: 'AI, Technology & Society',
              fileId: 'a',
              source: 'gmu-cs',
            },
            {
              SK: 'TERM#2025-3#SEC#002#b',
              termKey: '2025-3',
              termLabel: 'Fall 2025',
              section: '002',
              instructors: ['Bo'],
              fileId: 'b',
              source: 'gmu-cs',
            },
          ],
        };
      }
      return { Responses: { T: [] } };
    });
    const course = await createCatalog({ client, tableName: 'T' }).getCourse('CS399');
    expect(course.offerings[0].topic).toBe('AI, Technology & Society');
    expect(course.offerings[1]).not.toHaveProperty('topic');
  });
});

describe('last updated status', () => {
  test('reads both times from one item, and an empty table gives neither', async () => {
    const client = fakeClient((name, input) =>
      input.Key.SK === 'UPDATED' ? { Item: { PK: 'STATUS', SK: 'UPDATED', scrapedAt: 'a', uploadedAt: 'b' } } : {}
    );
    const catalog = createCatalog({ client, tableName: 'T' });
    expect(await catalog.getStatus()).toEqual({ scrapedAt: 'a', uploadedAt: 'b' });
    const empty = createCatalog({ client: fakeClient(() => ({})), tableName: 'T' });
    expect(await empty.getStatus()).toEqual({ scrapedAt: undefined, uploadedAt: undefined });
  });

  test('an approved upload only sets uploadedAt, so the scrape time is kept', async () => {
    const client = fakeClient(() => ({}));
    await createCatalog({ client, tableName: 'T' }).markUploaded();
    const { input } = client.send.mock.calls[0][0];
    expect(client.send.mock.calls[0][0].constructor.name).toBe('UpdateCommand');
    expect(input.Key).toEqual({ PK: 'STATUS', SK: 'UPDATED' });
    expect(input.UpdateExpression).toBe('SET uploadedAt = :now');
  });
});

describe('offerings list cache', () => {
  const offering = (code) => ({ PK: `COURSE#${code}`, SK: `TERM#2025-fall#SEC#001#f-${code}`, code });
  const throttled = () => Object.assign(new Error('Throughput exceeds the current capacity'), { name: 'ProvisionedThroughputExceededException' });

  // A fake client: scans return `rows` (or throw while `fail` is set); everything else succeeds.
  function setup() {
    const state = { rows: [offering('CS310')], fail: false, scans: 0 };
    const client = fakeClient((name) => {
      if (name === 'ScanCommand') {
        state.scans += 1;
        if (state.fail) throw throttled();
        return { Items: state.rows };
      }
      if (name === 'QueryCommand') return { Items: [] };
      if (name === 'UpdateCommand') return { Attributes: { hasSyllabi: true } };
      return {};
    });
    return { state, catalog: createCatalog({ client, tableName: 'T' }) };
  }

  afterEach(() => jest.useRealTimers());

  test('scans once and reuses the list for later and concurrent requests', async () => {
    const { state, catalog } = setup();
    const [a, b] = await Promise.all([catalog.listOfferings(), catalog.listOfferings()]);
    expect(await catalog.listOfferings()).toBe(a);
    expect(b).toBe(a);
    expect(state.scans).toBe(1);
    expect(a.map((o) => o.code)).toEqual(['CS310']);
  });

  test('scans again after the cache expires', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T12:00:00Z') });
    const { state, catalog } = setup();
    await catalog.listOfferings();
    jest.setSystemTime(new Date('2026-11-17T12:06:00Z'));
    state.rows = [offering('CS310'), offering('CS367')];
    expect((await catalog.listOfferings()).map((o) => o.code)).toEqual(['CS310', 'CS367']);
    expect(state.scans).toBe(2);
  });

  test('serves the last good list when a refresh is throttled', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T12:00:00Z') });
    const { state, catalog } = setup();
    await catalog.listOfferings();
    jest.setSystemTime(new Date('2026-11-17T12:06:00Z'));
    state.fail = true;
    expect((await catalog.listOfferings()).map((o) => o.code)).toEqual(['CS310']);
  });

  test('throws when the first scan is throttled and there is nothing to fall back on', async () => {
    const { state, catalog } = setup();
    state.fail = true;
    await expect(catalog.listOfferings()).rejects.toThrow('Throughput');
    state.fail = false;
    expect((await catalog.listOfferings()).map((o) => o.code)).toEqual(['CS310']);
  });

  test('a write clears the cache so the next request sees it', async () => {
    const { state, catalog } = setup();
    await catalog.listOfferings();
    state.rows = [];
    await catalog.deleteOffering(offering('CS310'));
    expect(await catalog.listOfferings()).toEqual([]);
    expect(state.scans).toBe(2);
  });
});
