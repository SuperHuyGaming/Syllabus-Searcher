// Virus scan of uploads with ClamAV. Talks to a clamd daemon over TCP (its INSTREAM
// command), so there's no extra package: locally clamd runs in Docker Compose, and in
// AWS, where Lambda can't hold ClamAV for free, scripts/virus-scan.js scans pending
// uploads from GitHub Actions instead.
//
// Results are stored in uploads.detected.virusScan:
//   { status: 'clean' | 'infected' | 'not-scanned' | 'error', signature?, engine?, error?, scannedAt? }
const net = require('node:net');
const config = require('../config');

const CHUNK = 64 * 1024;

// Sends one command (and an optional file) to clamd and returns its reply as text.
function clamd(command, { host = config.clamavHost, port = config.clamavPort, timeoutMs = 30000, body } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const parts = [];
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('ClamAV did not answer in time')));
    socket.on('error', reject);
    socket.on('data', (data) => parts.push(data));
    socket.on('end', () => resolve(Buffer.concat(parts).toString('utf8').replace(/\0/g, '').trim()));
    socket.on('connect', () => {
      // "z" commands end with a NUL byte. INSTREAM then takes the file in chunks,
      // each with a 4-byte length, and a zero length to finish.
      socket.write(`z${command}\0`);
      if (body) {
        for (let i = 0; i < body.length; i += CHUNK) {
          const chunk = body.subarray(i, i + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length);
          socket.write(size);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      }
    });
  });
}

// Scans a file. Returns { status: 'clean' | 'infected', signature?, engine, scannedAt }
// and throws if clamd can't be reached or answers with an error.
async function scanBuffer(buffer, options = {}) {
  const engine = await clamd('VERSION', options);
  const reply = await clamd('INSTREAM', { ...options, body: buffer });
  const scannedAt = new Date().toISOString();
  if (/^stream: OK$/.test(reply)) return { status: 'clean', engine, scannedAt };
  const found = reply.match(/^stream: (.+) FOUND$/);
  if (found) return { status: 'infected', signature: found[1], engine, scannedAt };
  throw new Error(`ClamAV: ${reply || 'no answer'}`);
}

async function ping(options = {}) {
  return (await clamd('PING', { timeoutMs: 5000, ...options })) === 'PONG';
}

// The scan made at upload time. Without CLAMAV_HOST (as in Lambda) the upload waits
// for the scheduled scan; a scanner that's down never blocks the upload either.
async function scanUpload(buffer, options = {}) {
  if (!(options.host || config.clamavHost)) return { status: 'not-scanned' };
  try {
    return await scanBuffer(buffer, options);
  } catch (err) {
    console.error('Virus scan failed', err);
    return { status: 'error', error: err.message, scannedAt: new Date().toISOString() };
  }
}

module.exports = { scanBuffer, scanUpload, ping };
