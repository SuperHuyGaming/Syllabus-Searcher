// Formats where a syllabus came from and when, for course page cards.
// Handles every scraper source (gmu-cs, gmu-math, gmu-cos / gmu-science, gmu-cehd,
// gmu-chss, gmu-masonkorea, archive, *-filename), student uploads, and unknown
// sources with a sourceUrl hostname fallback.

const ARCHIVE_HOST = /(^|\.)archive\.org$/i;
const CDN_HOST = /(^|\.)(cloudfront\.net|amazonaws\.com)$/i;

// Known scraper sources when sourceUrl isn't present or points to the archive.
const KNOWN_SOURCES = {
  'gmu-cs': { host: 'cs.gmu.edu', archived: true },
  'gmu-math': { host: 'math.gmu.edu', archived: false },
  'gmu-cos': { host: 'science.gmu.edu', archived: false },
  'gmu-science': { host: 'science.gmu.edu', archived: false },
  'gmu-cehd': { host: 'cehd.gmu.edu', archived: true },
  'gmu-chss': { host: 'chss.gmu.edu', archived: false },
  'gmu-masonkorea': { host: 'masonkorea.gmu.edu', archived: false },
};

export function isArchiveUrl(url) {
  if (!url) return false;
  try {
    return ARCHIVE_HOST.test(new URL(String(url)).hostname);
  } catch {
    return false;
  }
}

// Hostname of a syllabus source URL, without "www.". For Wayback Machine URLs
// (https://web.archive.org/web/<ts>/https://example.edu/...), returns "" so callers
// treat them as archive copies rather than "from web.archive.org".
export function sourceHost(url) {
  if (!url) return '';
  try {
    const host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '');
    return ARCHIVE_HOST.test(host) ? '' : host;
  } catch {
    return '';
  }
}

// "Mar 2026" in UTC so the month never shifts across time zones.
export function monthYearLabel(iso) {
  const time = iso ? new Date(iso) : null;
  if (!time || Number.isNaN(time.getTime())) return '';
  return time.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Structured provenance for one offering.
export function provenanceOf(offering) {
  const rawSource = String(offering?.source || '').trim().toLowerCase();
  const url = offering?.sourceUrl || offering?.source_url || '';
  const timestamp = offering?.approvedAt || offering?.uploadedAt || offering?.createdAt || '';
  const term = String(offering?.termLabel || '').trim();
  const isFilenameInferred = rawSource.endsWith('-filename');
  const baseSource = isFilenameInferred ? rawSource.slice(0, -'-filename'.length) : rawSource;
  const archiveUrl = isArchiveUrl(url);
  const host = sourceHost(url);
  const known = KNOWN_SOURCES[baseSource] || null;
  const isUpload = baseSource === 'upload';
  const isArchive = baseSource === 'archive' || archiveUrl || Boolean(known?.archived);

  let origin = '';
  if (isUpload) {
    const approved = monthYearLabel(timestamp);
    origin = approved ? `Student upload · approved ${approved}` : 'Student upload';
  } else if (baseSource === 'archive' || (archiveUrl && !known)) {
    origin = 'Internet Archive copy';
  } else if (known) {
    // CHSS and Mason Korea store files on a CloudFront CDN; show the college domain instead of the CDN host.
    const displayHost = host && !CDN_HOST.test(host) ? host : known.host;
    origin = known.archived || archiveUrl ? `from ${displayHost} (Internet Archive)` : `from ${displayHost}`;
  } else if (host) {
    origin = `from ${host}`;
  }

  return {
    term,
    origin,
    host: host || known?.host || '',
    isUpload,
    isArchive,
    isFilenameInferred,
  };
}

// One-line provenance label for a syllabus card, e.g.:
//   "Fall 2025 · from historyarthistory.gmu.edu"
//   "Fall 2024 · from cs.gmu.edu (Internet Archive)"
//   "Student upload · approved Mar 2026"
//   "Internet Archive copy"
export function provenanceLabel(offering, { includeTerm = true } = {}) {
  const { term, origin } = provenanceOf(offering);
  const parts = [];
  if (includeTerm && term) parts.push(term);
  if (origin) parts.push(origin);
  return parts.join(' · ');
}
