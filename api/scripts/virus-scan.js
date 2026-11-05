// Virus-scans pending uploads with ClamAV and saves the result on each upload
// (uploads.detected.virusScan), where the admin card shows it. Lambda has no ClamAV,
// so in AWS uploads arrive "not scanned" and this script, run from Actions → "Virus
// scan" every two hours, scans them. It also retries scans that failed.
//
//   node scripts/virus-scan.js --count      # prints how many pending uploads need a scan
//   node scripts/virus-scan.js              # scans them (waits up to --wait seconds for clamd)
//   node scripts/virus-scan.js --all        # scans every pending upload again
//
// Uses SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MONGODB_URI, MONGODB_DB and
// CLAMAV_HOST / CLAMAV_PORT. Locally: docker compose run --rm api node scripts/virus-scan.js
const { createUploads } = require('../src/repos/uploads');
const { createFiles } = require('../src/repos/files');
const { scanBuffer, ping } = require('../src/lib/virusscan');

const DONE = new Set(['clean', 'infected']);

function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
}

// clamd loads its signatures for up to a minute or two after it starts.
async function waitForClamd(seconds) {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    if (await ping().catch(() => false)) return;
    if (Date.now() > until) throw new Error(`ClamAV was not ready after ${seconds} seconds`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const wait = option(args, '--wait', 300);

  const uploads = createUploads();
  const todo = (await uploads.listPending()).filter((u) => all || !DONE.has(u.detected?.virusScan?.status));
  if (args.includes('--count')) {
    console.log(todo.length);
    return;
  }
  console.log(`${todo.length} pending upload(s) to scan.`);
  if (todo.length === 0) return;

  await waitForClamd(wait);
  const files = createFiles();
  let infected = 0;
  for (const upload of todo) {
    const label = `${upload.course_code} ${upload.term_key} sec ${upload.section} (${upload.id})`;
    const file = await files.read('pending', upload.file_id);
    if (!file) {
      console.log(`- ${label}: file missing, skipped`);
      continue;
    }
    const virusScan = await scanBuffer(file.buffer);
    // saveDetected only touches uploads that are still pending.
    await uploads.saveDetected(upload.id, { ...upload.detected, virusScan });
    if (virusScan.status === 'infected') infected += 1;
    console.log(`- ${label}: ${virusScan.status}${virusScan.signature ? ` (${virusScan.signature})` : ''}`);
  }
  console.log(`Done. ${infected} infected; reject those in /admin.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message);
    process.exit(1);
  }
);
