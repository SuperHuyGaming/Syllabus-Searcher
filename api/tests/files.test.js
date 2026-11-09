const { ObjectId } = require('mongodb');
const { createFiles } = require('../src/repos/files');

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
