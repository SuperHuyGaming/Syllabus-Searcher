// Syllabus files live in MongoDB GridFS. Two buckets:
//   pending -> student uploads waiting for review
//   syllabi -> approved and scraped files the site serves
// The scraper keeps scraped files in the site's Supabase Storage (bucket "syllabi", each one
// recorded in the main database's "stored_files" collection) and on more than one free Atlas
// cluster (MONGODB_URI_2, ..., see scraper/syllabus_scraper/pool.py). File ids stay plain
// ObjectIds, so reads and deletes look in the main cluster first, then each extra one, then
// Supabase Storage. New files from the site (uploads, approvals) are written to the main cluster.
const crypto = require('crypto');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

// S3-compatible DELETE client for Cloudflare R2, enabled only when all 4 credentials are set.
function createR2Client(env = process.env, fetchFn = globalThis.fetch) {
  const endpoint = (env.R2_ENDPOINT || '').trim().replace(/\/+$/, '');
  const accessKeyId = (env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (env.R2_BUCKET || '').trim();
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;

  return {
    async deleteObject(key, now = new Date()) {
      const encodedKey = key.split('/').map(encodeURIComponent).join('/');
      const url = new URL(`${endpoint}/${encodeURIComponent(bucket)}/${encodedKey}`);
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.slice(0, 8);
      const region = 'auto';
      const service = 's3';
      const canonicalHeaders =
        `host:${url.host}\n` +
        `x-amz-content-sha256:${EMPTY_SHA256}\n` +
        `x-amz-date:${amzDate}\n`;
      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
      const canonicalRequest = ['DELETE', url.pathname, '', canonicalHeaders, signedHeaders, EMPTY_SHA256].join('\n');
      const scope = `${dateStamp}/${region}/${service}/aws4_request`;
      const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        scope,
        crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
      ].join('\n');
      const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
      const kRegion = hmacSha256(kDate, region);
      const kService = hmacSha256(kRegion, service);
      const kSigning = hmacSha256(kService, 'aws4_request');
      const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
      const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const res = await fetchFn(url.toString(), {
        method: 'DELETE',
        headers: {
          'x-amz-content-sha256': EMPTY_SHA256,
          'x-amz-date': amzDate,
          Authorization: authorization,
        },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`R2 delete failed (${res.status})`);
      }
    },
  };
}

function r2ObjectKey(record) {
  if (typeof record?.key === 'string' && record.key.trim()) return record.key.trim();
  if (typeof record?.link === 'string') {
    try {
      const path = new URL(record.link).pathname.replace(/^\/+/, '');
      return path || null;
    } catch {
      return null;
    }
  }
  return null;
}

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
    host === 'files.bentruong.dev' ||
    host === 'web.archive.org' ||
    host === 'gmu.edu' ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.gmu\.edu$/.test(host)
  );
}

// Reads bytes from a files.read() result: returns buffer directly for GridFS/Supabase files,
// or fetches via the public link for storage === 'r2' records. Returns null for external links.
async function readFileBuffer(file, { fetchFn = globalThis.fetch } = {}) {
  if (!file) return null;
  if (file.buffer) return file.buffer;
  if (file.storage === 'r2' && file.link) {
    if (!isAllowedLink(file.link)) return null;
    try {
      const res = await fetchFn(file.link);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.error('R2 public fetch failed', err.message);
      return null;
    }
  }
  return null;
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
        .find(
          { _id: { $in: objectIds }, link: { $type: 'string', $ne: '' }, storage: { $ne: 'r2' } },
          { projection: { _id: 1, link: 1, storage: 1 } }
        )
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

// db/pool/makeBucket/stored/r2 are for tests: the main database, the extra ones, how to open a
// bucket, the Supabase Storage files, and the optional R2 delete client.
function createFiles({ db, pool, makeBucket = gridFsBucket, stored, r2 } = {}) {
  const database = () => (db ? Promise.resolve(db) : getDb());
  const inSupabase = stored || supabaseStored(database);
  const r2Client = r2 !== undefined ? r2 : createR2Client();
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
          ...(record.storage ? { storage: record.storage } : {}),
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
        return new Set(docs.filter((d) => d.link && d.storage !== 'r2').map((d) => d._id.toHexString()));
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
      if (record) {
        if (record.storage === 'r2') {
          const key = r2ObjectKey(record);
          if (r2Client && key) {
            await r2Client.deleteObject(key);
          } else {
            console.log(`R2 credentials not configured; removing DB record only for ${objectId.toHexString()}`);
          }
          await inSupabase.remove(objectId, { linkOnly: true });
        } else {
          await inSupabase.remove(objectId, { linkOnly: Boolean(record.link) });
        }
      }
    },

    async ping() {
      await (await database()).command({ ping: 1 });
    },
  };
}

module.exports = { createFiles, getDb, isAllowedLink, readFileBuffer, createR2Client };
