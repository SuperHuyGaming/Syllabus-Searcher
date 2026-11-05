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
            { SK: 'TERM#2024-3#SEC#001#a', termKey: '2024-3', section: '001', instructors: ['Ada'], fileId: 'a' },
            { SK: 'TERM#2024-3#SEC#002#b', termKey: '2024-3', section: '002', instructors: ['Bo'], fileId: 'b' },
          ],
        };
      }
      return { Responses: { T: [record('a')] } };
    });
    const course = await createCatalog({ client, tableName: 'T' }).getCourse('CS310');
    expect(course.offerings[0].summary.summary.overview).toBe('About a');
    expect(course.offerings[1].summary).toBeNull();
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
