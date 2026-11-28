// Syllabus files live in MongoDB GridFS. Two buckets:
//   pending -> student uploads waiting for review
//   syllabi -> approved and scraped files the site serves
// The scraper keeps scraped files in the site's Supabase Storage (bucket "syllabi", each one
// recorded in the main database's "stored_files" collection) and on more than one free Atlas
// cluster (MONGODB_URI_2, ..., see scraper/syllabus_scraper/pool.py). File ids stay plain
// ObjectIds, so reads and deletes look in the main cluster first, then each extra one, then
// Supabase Storage. New files from the site (uploads, approvals) are written to the main cluster.
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// Lambda reuses the module between invocations, so connections are shared.
const clients = new Map();
function connect(uri) {
  if (!clients.has(uri)) {
    clients.set(
      uri,
      new MongoClient(uri, { maxPoolSize: 2 }).connect().catch((err) => {
        clients.delete(uri);
        throw err;
      })
    );
  }
  return clients.get(uri).then((client) => client.db(config.mongoDb));
}

function getDb() {
  return connect(config.mongoUri);
}

function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

// Hosts that link-only syllabi may redirect to. Anything else is refused with 404.
function isAllowedLink(raw) {
  if (typeof raw !== 'string' || !raw || raw !== raw.trim()) return false;
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === 'd101vc9winf8ln.cloudfront.net' ||
    host === 'gmu.edu' ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.gmu\.edu$/.test(host)
  );
}

const gridFsBucket = (db, name) => new GridFSBucket(db, { bucketName: name });

// Scraped files in Supabase Storage (and link-only records): the record in "stored_files" and the object itself.
function supabaseStored(database) {
  let client;
  const bucket = () => {
    if (!config.supabaseUrl || !config.supabaseServiceKey) return null;
    client ||= createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return client.storage.from('syllabi');
  };
  const records = async () => (await database()).collection('stored_files');
  return {
    find: async (objectId) => (await records()).findOne({ _id: objectId }),
    async findLinked(objectIds) {
      if (objectIds.length === 0) return [];
      return (await records())
        .find({ _id: { $in: objectIds }, link: { $type: 'string', $ne: '' } }, { projection: { _id: 1, link: 1 } })
        .toArray();
    },
    async download(id) {
      const storage = bucket();
      if (!storage) return null;
      const { data, error } = await storage.download(id);
      if (error) throw new Error(`Supabase Storage: ${error.message}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(objectId, { linkOnly = false } = {}) {
      if (!linkOnly) {
        const storage = bucket();
        if (storage) await storage.remove([objectId.toHexString()]);
      }
      await (await records()).deleteOne({ _id: objectId });
    },
  };
}

// db/pool/makeBucket/stored are for tests: the main database, the extra ones, how to open a
// bucket, and the Supabase Storage files.
function createFiles({ db, pool, makeBucket = gridFsBucket, stored } = {}) {
  const database = () => (db ? Promise.resolve(db) : getDb());
  const inSupabase = stored || supabaseStored(database);
  // Only scraped files (bucket "syllabi") are kept in Supabase Storage.
  async function storedRecord(name, objectId) {
    if (name !== 'syllabi') return null;
    try {
      return await inSupabase.find(objectId);
    } catch (err) {
      console.error('stored_files lookup failed', err.message);
      return null;
    }
  }
  const extras = () => (pool ? Promise.resolve(pool) : Promise.all(config.mongoPoolUris.map(connect)));
  const bucket = async (name) => makeBucket(await database(), name);
  // Every cluster's bucket, main first. An extra cluster that can't be reached is skipped.
  async function buckets(name) {
    const others = await extras().catch((err) => {
      console.error('storage pool unavailable', err.message);
      return [];
    });
    return [await database(), ...others].map((d) => makeBucket(d, name));
  }

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
      for (const target of await buckets(name)) {
        const [file] = await target.find({ _id: objectId }).limit(1).toArray();
        if (!file) continue;
        const chunks = [];
        for await (const chunk of target.openDownloadStream(objectId)) chunks.push(chunk);
        return {
          buffer: Buffer.concat(chunks),
          filename: file.filename,
          contentType: file.metadata?.contentType || 'application/octet-stream',
          metadata: file.metadata || {},
        };
      }
      const record = await storedRecord(name, objectId);
      if (!record) return null;
      if (record.link) {
        return {
          link: record.link,
          filename: record.filename,
          contentType: record.metadata?.contentType || 'application/octet-stream',
          metadata: record.metadata || {},
        };
      }
      const buffer = await inSupabase.download(id);
      if (!buffer) return null;
      return {
        buffer,
        filename: record.filename,
        contentType: record.metadata?.contentType || 'application/octet-stream',
        metadata: record.metadata || {},
      };
    },

    // Which of these file ids are stored as link-only records (a Set of hex ids).
    async linkedIds(ids) {
      const objectIds = [...new Set((ids || []).filter(Boolean))].map(toObjectId).filter(Boolean);
      if (objectIds.length === 0 || !inSupabase.findLinked) return new Set();
      try {
        const docs = await inSupabase.findLinked(objectIds);
        return new Set(docs.filter((d) => d.link).map((d) => d._id.toHexString()));
      } catch (err) {
        console.error('stored_files linked lookup failed', err.message);
        return new Set();
      }
    },

    // Approving an upload copies it into the public bucket under the same id.
    // Returns { id, contentType }, or null if the file is gone.
    async move(from, to, id) {
      const file = await this.read(from, id);
      if (!file || !file.buffer) return null;
      await write(to, file.buffer, {
        id: toObjectId(id),
        filename: file.filename,
        contentType: file.contentType,
        metadata: file.metadata,
      });
      await this.remove(from, id);
      return { id, contentType: file.contentType };
    },

    // Deletes the file from whichever cluster has it.
    async remove(name, id) {
      const objectId = toObjectId(id);
      if (!objectId) return;
      for (const target of await buckets(name)) {
        try {
          await target.delete(objectId);
          return;
        } catch (err) {
          if (!/FileNotFound|File not found/i.test(err.message)) throw err;
        }
      }
      const record = await storedRecord(name, objectId);
      if (record) await inSupabase.remove(objectId, { linkOnly: Boolean(record.link) });
    },

    async ping() {
      await (await database()).command({ ping: 1 });
    },
  };
}

module.exports = { createFiles, getDb, isAllowedLink };
