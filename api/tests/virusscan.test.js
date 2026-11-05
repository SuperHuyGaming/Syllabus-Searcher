const net = require('node:net');
const { scanBuffer, scanUpload, ping } = require('../src/lib/virusscan');

// A small stand-in for clamd: answers PING and VERSION, reads an INSTREAM file and
// reports the EICAR test string as a virus, the way ClamAV does.
function fakeClamd() {
  const received = [];
  const server = net.createServer((socket) => {
    let data = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      const end = data.indexOf(0);
      if (end === -1) return;
      const command = data.subarray(0, end).toString();
      if (command === 'zPING') return socket.end('PONG\0');
      if (command === 'zVERSION') return socket.end('ClamAV 1.4.3/27800/Tue Nov  3 08:00:00 2026\0');
      if (command !== 'zINSTREAM') return socket.end('UNKNOWN COMMAND\0');
      // Read length-prefixed chunks until the zero length.
      let at = end + 1;
      const parts = [];
      while (at + 4 <= data.length) {
        const size = data.readUInt32BE(at);
        if (size === 0) {
          const file = Buffer.concat(parts);
          received.push(file);
          return socket.end(file.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
        }
        if (at + 4 + size > data.length) return;
        parts.push(data.subarray(at + 4, at + 4 + size));
        at += 4 + size;
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, received, options: { host: '127.0.0.1', port: server.address().port } }));
  });
}

describe('virus scan', () => {
  let clamd;
  beforeAll(async () => {
    clamd = await fakeClamd();
  });
  afterAll(() => clamd.server.close());

  test('a clean file passes, sent whole in several chunks', async () => {
    const file = Buffer.alloc(200 * 1024, 'a');
    const result = await scanBuffer(file, clamd.options);
    expect(result).toMatchObject({ status: 'clean', engine: expect.stringMatching(/^ClamAV 1\.4/) });
    expect(clamd.received.at(-1).equals(file)).toBe(true);
  });

  test('the EICAR test file is reported with its signature', async () => {
    const eicar = Buffer.from('%PDF-1.7 X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    expect(await scanBuffer(eicar, clamd.options)).toMatchObject({ status: 'infected', signature: 'Eicar-Test-Signature' });
  });

  test('ping says whether clamd is up', async () => {
    expect(await ping(clamd.options)).toBe(true);
  });

  test('without a scanner the upload waits for the scheduled scan', async () => {
    expect(await scanUpload(Buffer.from('x'))).toEqual({ status: 'not-scanned' });
  });

  test('a scanner that is down never fails the upload', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await scanUpload(Buffer.from('x'), { host: '127.0.0.1', port: 1 });
    console.error.mockRestore();
    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
  });
});

// Against a real clamd, when one is given (the "clamav" CI job starts the same image
// as docker-compose.yml). The EICAR string is built here so no virus scanner on a
// developer's machine quarantines this file.
const realHost = process.env.CLAMAV_TEST_HOST;
(realHost ? describe : describe.skip)('virus scan with real ClamAV', () => {
  const options = { host: realHost, port: Number(process.env.CLAMAV_TEST_PORT || 3310) };

  beforeAll(async () => {
    // clamd loads its signatures for a minute or two after it starts.
    const until = Date.now() + 240000;
    while (!(await ping(options).catch(() => false))) {
      if (Date.now() > until) throw new Error('ClamAV was not ready');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }, 250000);

  test('a PDF is clean and EICAR is caught', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
    expect(await scanBuffer(pdf, options)).toMatchObject({ status: 'clean', engine: expect.stringMatching(/^ClamAV /) });
    const eicar = [String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$`, 'EICAR-STANDARD-ANTIVIRUS', '-TEST-FILE!$H+H*'].join('');
    expect(eicar).toHaveLength(68);
    expect(await scanBuffer(Buffer.from(eicar), options)).toMatchObject({ status: 'infected', signature: expect.stringMatching(/Eicar/i) });
  });
});
