// Builds the XML sitemap served at /api/sitemap.xml (CloudFront routes /api/* to Lambda).
const { DEFAULT_SCHOOL, schoolOf } = require('./terms');
const { groupByProfessor } = require('./professors');

const DEFAULT_SITE_URL = 'https://findmysyllabus.bentruong.dev';

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Formats an ISO timestamp (including Python's microseconds / +00:00) as YYYY-MM-DD.
function formatLastmod(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

// Picks the newer valid ISO timestamp between two candidates.
function newerIso(a, b) {
  const ma = a ? Date.parse(a) : NaN;
  const mb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ma)) return Number.isNaN(mb) ? null : new Date(mb).toISOString();
  if (Number.isNaN(mb)) return new Date(ma).toISOString();
  return new Date(Math.max(ma, mb)).toISOString();
}

// Resolves the canonical public origin for sitemap <loc> entries.
function resolveSiteUrl(event, configuredUrl = '') {
  if (configuredUrl) return configuredUrl.replace(/\/+$/, '');
  const headers = event?.headers || {};
  const forwardedHost = (headers['x-forwarded-host'] || '').split(',')[0].trim();
  if (forwardedHost) {
    const proto = (headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    return `${proto}://${forwardedHost}`.replace(/\/+$/, '');
  }
  const host = (headers.host || '').trim();
  if (host && !host.includes('.lambda-url.')) {
    const isLocal = /^localhost(?::|$)|^127\.0\.0\.1(?::|$)/.test(host);
    return `${isLocal ? 'http' : 'https'}://${host}`.replace(/\/+$/, '');
  }
  return DEFAULT_SITE_URL;
}

function professorUrl(baseUrl, slug, school) {
  const encoded = encodeURIComponent(slug);
  return school === DEFAULT_SCHOOL
    ? `${baseUrl}/professors/${encoded}`
    : `${baseUrl}/professors/${encoded}?school=${encodeURIComponent(school)}`;
}

function buildSitemap({ baseUrl = DEFAULT_SITE_URL, schools = [], offerings = [], lastUpdated = null } = {}) {
  const origin = String(baseUrl || DEFAULT_SITE_URL).replace(/\/+$/, '');
  const siteLastmod = formatLastmod(lastUpdated);
  const entries = [];
  const seen = new Set();

  const add = (loc, lastmod) => {
    if (seen.has(loc)) return;
    seen.add(loc);
    entries.push({ loc, lastmod: lastmod || siteLastmod });
  };

  // Core static pages
  add(`${origin}/`, siteLastmod);
  add(`${origin}/professors`, siteLastmod);
  add(`${origin}/search`, siteLastmod);
  add(`${origin}/upload`, siteLastmod);

  // Additional schools
  const schoolKeys = new Set([DEFAULT_SCHOOL]);
  for (const s of schools) {
    const key = typeof s === 'string' ? s : s?.key;
    if (!key) continue;
    schoolKeys.add(key);
    if (key !== DEFAULT_SCHOOL) {
      add(`${origin}/?school=${encodeURIComponent(key)}`, siteLastmod);
      add(`${origin}/professors?school=${encodeURIComponent(key)}`, siteLastmod);
    }
  }

  // Course pages (deduplicated, sorted deterministically)
  const courseDates = new Map();
  const offeringsBySchool = new Map();
  for (const o of offerings) {
    if (!o?.code) continue;
    const school = schoolOf(o.code);
    schoolKeys.add(school);
    if (!offeringsBySchool.has(school)) offeringsBySchool.set(school, []);
    offeringsBySchool.get(school).push(o);

    const prev = courseDates.get(o.code) || null;
    const candidate = newerIso(o.updatedAt, o.createdAt);
    courseDates.set(o.code, newerIso(prev, candidate));
  }

  const sortedCodes = [...courseDates.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const code of sortedCodes) {
    // Keep ":" unencoded in school-prefixed codes like "unc:COMP110" to match React Router links.
    const encoded = code.split(':').map(encodeURIComponent).join(':');
    add(`${origin}/courses/${encoded}`, formatLastmod(courseDates.get(code)));
  }

  // Professor pages per school
  const sortedSchools = [...schoolKeys].sort((a, b) => Number(b === DEFAULT_SCHOOL) - Number(a === DEFAULT_SCHOOL) || a.localeCompare(b));
  for (const school of sortedSchools) {
    const list = offeringsBySchool.get(school);
    if (!list?.length) continue;
    for (const prof of groupByProfessor(list)) {
      let latest = null;
      for (const o of prof.offerings) {
        latest = newerIso(latest, newerIso(o.updatedAt, o.createdAt));
      }
      add(professorUrl(origin, prof.slug, school), formatLastmod(latest));
    }
  }

  const body = entries
    .map(({ loc, lastmod }) => {
      const parts = [`    <loc>${escapeXml(loc)}</loc>`];
      if (lastmod) parts.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

module.exports = {
  DEFAULT_SITE_URL,
  escapeXml,
  formatLastmod,
  newerIso,
  resolveSiteUrl,
  buildSitemap,
};
