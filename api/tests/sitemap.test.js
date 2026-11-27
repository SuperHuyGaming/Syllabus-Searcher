const { createApp } = require('../src/app');
const {
  DEFAULT_SITE_URL,
  buildSitemap,
  escapeXml,
  formatLastmod,
  newerIso,
  resolveSiteUrl,
} = require('../src/lib/sitemap');

describe('sitemap helpers', () => {
  test('escapeXml escapes all five XML special characters', () => {
    expect(escapeXml(`https://example.com/?a=1&b="x"&c='<y>'`)).toBe(
      'https://example.com/?a=1&amp;b=&quot;x&quot;&amp;c=&apos;&lt;y&gt;&apos;'
    );
  });

  test('formatLastmod handles JS ISO, Python microseconds +00:00, and invalid dates', () => {
    expect(formatLastmod('2026-11-02T09:40:00.123456+00:00')).toBe('2026-11-02');
    expect(formatLastmod('2026-11-01T18:00:00.000Z')).toBe('2026-11-01');
    expect(formatLastmod(null)).toBeNull();
    expect(formatLastmod('not-a-date')).toBeNull();
  });

  test('newerIso picks the newer valid timestamp', () => {
    expect(newerIso('2026-11-01T00:00:00Z', '2026-11-05T12:00:00Z')).toBe('2026-11-05T12:00:00.000Z');
    expect(newerIso('2026-11-05T12:00:00Z', null)).toBe('2026-11-05T12:00:00.000Z');
    expect(newerIso(undefined, 'bad')).toBeNull();
  });

  test('resolveSiteUrl prefers configured URL, then forwarded host, then non-lambda host, then default', () => {
    expect(resolveSiteUrl({ headers: { host: 'localhost:8080' } }, 'https://syllabus.example.com/')).toBe(
      'https://syllabus.example.com'
    );
    expect(
      resolveSiteUrl({ headers: { 'x-forwarded-host': 'staging.findmysyllabus.bentruong.dev', 'x-forwarded-proto': 'https' } })
    ).toBe('https://staging.findmysyllabus.bentruong.dev');
    expect(resolveSiteUrl({ headers: { host: 'localhost:8080' } })).toBe('http://localhost:8080');
    expect(resolveSiteUrl({ headers: { host: 'abc123.lambda-url.us-east-2.on.aws' } })).toBe(DEFAULT_SITE_URL);
    expect(resolveSiteUrl({})).toBe(DEFAULT_SITE_URL);
  });
});

describe('buildSitemap', () => {
  test('generates valid XML with static, school, course, and professor URLs and lastmod', () => {
    const xml = buildSitemap({
      baseUrl: 'https://findmysyllabus.bentruong.dev/',
      schools: [
        { key: 'gmu', name: 'George Mason University' },
        { key: 'unc', name: 'UNC Chapel Hill' },
      ],
      offerings: [
        {
          code: 'CS310',
          termKey: '2024-3',
          section: '001',
          instructors: ['Zhu, Ziwei'],
          fileId: 'a'.repeat(24),
          updatedAt: '2026-10-15T12:00:00Z',
        },
        {
          code: 'CS310',
          termKey: '2024-1',
          section: '002',
          instructors: ['Zhu, Z'],
          fileId: 'b'.repeat(24),
          createdAt: '2026-09-01T12:00:00Z',
        },
        {
          code: 'unc:COMP110',
          termKey: '2024-3',
          section: '001',
          instructors: ['Jordan, Kris'],
          fileId: 'c'.repeat(24),
        },
      ],
      lastUpdated: '2026-11-02T09:40:00.123456+00:00',
    });

    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    expect(xml).toContain('<loc>https://findmysyllabus.bentruong.dev/</loc>');
    expect(xml).toContain('<loc>https://findmysyllabus.bentruong.dev/professors</loc>');
    expect(xml).toContain('<loc>https://findmysyllabus.bentruong.dev/search</loc>');
    expect(xml).toContain('<loc>https://findmysyllabus.bentruong.dev/upload</loc>');
    expect(xml).toContain('<loc>https://findmysyllabus.bentruong.dev/?school=unc</loc>');
    expect(xml).toContain('<loc>https://findmysyllabus.bentruong.dev/professors?school=unc</loc>');
    expect(xml).toContain('<loc>https://findmysyllabus.bentruong.dev/courses/CS310</loc>\n    <lastmod>2026-10-15</lastmod>');
    expect(xml).toContain('<loc>https://findmysyllabus.bentruong.dev/courses/unc:COMP110</loc>\n    <lastmod>2026-11-02</lastmod>');
    // "Zhu, Z" merges into "Zhu, Ziwei" via groupByProfessor
    expect(xml).toContain('<loc>https://findmysyllabus.bentruong.dev/professors/zhu-ziwei</loc>\n    <lastmod>2026-10-15</lastmod>');
    expect(xml).not.toContain('professors/zhu-z<');
    expect(xml).toContain('<loc>https://findmysyllabus.bentruong.dev/professors/jordan-kris?school=unc</loc>');
    // No duplicate CS310 entry
    expect(xml.match(/\/courses\/CS310</g)).toHaveLength(1);
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });

  test('escapes XML characters in baseUrl and query strings', () => {
    const xml = buildSitemap({
      baseUrl: 'https://example.com/?a=1&b=2',
      schools: [],
      offerings: [],
    });
    expect(xml).toContain('&amp;');
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  test('omits <lastmod> when no timestamps exist', () => {
    const xml = buildSitemap({ baseUrl: 'https://example.com', schools: [], offerings: [], lastUpdated: null });
    expect(xml).not.toContain('<lastmod>');
  });
});

describe('GET /api/sitemap.xml route', () => {
  test('serves XML sitemap with cache headers', async () => {
    const deps = {
      catalog: {
        listOfferings: jest.fn().mockResolvedValue([
          { code: 'CS310', termKey: '2024-3', section: '001', instructors: ['Ada Lovelace'], fileId: 'a'.repeat(24) },
        ]),
        getStatus: jest.fn().mockResolvedValue({ scrapedAt: '2026-11-02T09:40:00.000Z' }),
      },
      departments: {
        schools: jest.fn().mockResolvedValue([{ key: 'gmu', name: 'George Mason University' }]),
      },
      files: {},
      uploads: {},
      search: {},
    };

    const app = createApp(deps);
    const res = await app({
      rawPath: '/api/sitemap.xml',
      headers: { host: 'findmysyllabus.bentruong.dev' },
      requestContext: { http: { method: 'GET', sourceIp: '1.2.3.4' } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/xml; charset=utf-8');
    expect(res.headers['Cache-Control']).toContain('s-maxage=3600');
    expect(res.body).toContain('<loc>https://findmysyllabus.bentruong.dev/courses/CS310</loc>');
    expect(res.body).toContain('<loc>https://findmysyllabus.bentruong.dev/professors/ada-lovelace</loc>');
    expect(res.body).toContain('<lastmod>2026-11-02</lastmod>');
  });
});
