// Syllabus files live in MongoDB GridFS. Two buckets:
//   pending -> student uploads waiting for review
//   syllabi -> approved and scraped files the site serves
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const config = require('../config');

// Lambda reuses the module between invocations, so the connection is shared.
let clientPromise;
function getDb() {
  if (!clientPromise) {
    clientPromise = new MongoClient(config.mongoUri, { maxPoolSize: 2 }).connect().catch((err) => {
      clientPromise = undefined;
      throw err;
    });
  }
  return clientPromise.then((client) => client.db(config.mongoDb));
}

function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function createFiles({ db } = {}) {
  const database = () => (db ? Promise.resolve(db) : getDb());
  const bucket = async (name) => new GridFSBucket(await database(), { bucketName: name });

  async function write(name, buffer, { id = new ObjectId(), filename, contentType, metadata }) {
    const target = await bucket(name);
    await new Promise((resolve, reject) => {
      target
        .openUploadStreamWithId(id, filename, { metadata: { ...metadata, contentType } })
        .on('finish', resolve)
        .on('error', reject)
        .end(buffer);
    });
    return id.toHexString();
  }

  return {
    save: (name, buffer, options) => write(name, buffer, options),

    async read(name, id) {
      const objectId = toObjectId(id);
      if (!objectId) return null;
      const target = await bucket(name);
      const [file] = await target.find({ _id: objectId }).limit(1).toArray();
      if (!file) return null;
      const chunks = [];
      for await (const chunk of target.openDownloadStream(objectId)) chunks.push(chunk);
      return {
        buffer: Buffer.concat(chunks),
        filename: file.filename,
        contentType: file.metadata?.contentType || 'application/octet-stream',
        metadata: file.metadata || {},
      };
    },

    // Approving an upload copies it into the public bucket under the same id.
    // Returns { id, contentType }, or null if the file is gone.
    async move(from, to, id) {
      const file = await this.read(from, id);
      if (!file) return null;
      await write(to, file.buffer, {
        id: toObjectId(id),
        filename: file.filename,
        contentType: file.contentType,
        metadata: file.metadata,
      });
      await this.remove(from, id);
      return { id, contentType: file.contentType };
    },

    async remove(name, id) {
      const objectId = toObjectId(id);
      if (!objectId) return;
      try {
        await (await bucket(name)).delete(objectId);
      } catch (err) {
        if (!/FileNotFound|File not found/i.test(err.message)) throw err;
      }
    },

    async ping() {
      await (await database()).command({ ping: 1 });
    },
  };
}

module.exports = { createFiles, getDb };
