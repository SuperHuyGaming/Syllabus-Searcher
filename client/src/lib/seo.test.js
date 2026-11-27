import { createElement } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  SITE_NAME,
  courseJsonLd,
  courseMeta,
  professorMeta,
  serializeJsonLd,
  usePageMeta,
} from './seo';

const GMU = { key: 'gmu', name: 'George Mason University', short: 'GMU' };
const UNC = { key: 'unc', name: 'University of North Carolina at Chapel Hill', short: 'UNC' };

function MetaHarness({ meta }) {
  usePageMeta(meta);
  return null;
}

afterEach(() => {
  cleanup();
  document.title = '';
  document.head.innerHTML = '';
});

describe('courseMeta', () => {
  test('formats course title, description, and canonical path', () => {
    const meta = courseMeta(
      {
        code: 'CS310',
        display: 'CS 310',
        title: 'Data Structures',
        description: 'Linear and tree data structures in Java.',
        offerings: [{ fileId: 'a' }, { fileId: 'b' }],
      },
      GMU
    );
    expect(meta.title).toBe('CS 310 Data Structures syllabus · George Mason University');
    expect(meta.description).toContain('Browse 2 past CS 310 syllabi at George Mason University.');
    expect(meta.description).toContain('Linear and tree data structures in Java.');
    expect(meta.canonical).toBe('/courses/CS310');
  });

  test('handles singular offering and other schools', () => {
    const meta = courseMeta(
      { code: 'unc:COMP110', display: 'COMP 110', title: 'Intro to Programming', offerings: [{ fileId: 'a' }] },
      UNC
    );
    expect(meta.title).toBe('COMP 110 Intro to Programming syllabus · University of North Carolina at Chapel Hill');
    expect(meta.description).toContain('1 past COMP 110 syllabus');
    expect(meta.canonical).toBe('/courses/unc:COMP110');
  });

  test('handles courses without syllabi or missing course', () => {
    const empty = courseMeta({ code: 'MATH113', title: 'Calculus I', offerings: [] }, GMU);
    expect(empty.title).toBe('MATH 113 Calculus I syllabus · George Mason University');
    expect(empty.description).toContain('upload a syllabus');

    const fallback = courseMeta(null, GMU);
    expect(fallback.title).toBe(DEFAULT_TITLE);
    expect(fallback.description).toBe(DEFAULT_DESCRIPTION);
  });

  test('truncates long descriptions cleanly', () => {
    const longDesc = 'word '.repeat(60).trim();
    const meta = courseMeta({ code: 'CS310', title: 'Data Structures', description: longDesc, offerings: [] }, GMU);
    expect(meta.description.length).toBeLessThanOrEqual(160);
    expect(meta.description.endsWith('…')).toBe(true);
  });
});

describe('professorMeta', () => {
  test('works with a professor object', () => {
    const meta = professorMeta(
      { name: 'Zhu, Ziwei', slug: 'zhu-ziwei', courses: ['CS310', 'CS483'], offerings: [{}, {}, {}] },
      GMU
    );
    expect(meta.title).toBe('Zhu, Ziwei syllabi · George Mason University');
    expect(meta.description).toBe('View 3 past syllabi taught by Zhu, Ziwei across 2 courses at George Mason University.');
    expect(meta.canonical).toBe('/professors/zhu-ziwei');
    expect(meta.type).toBe('profile');
  });

  test('works with a plain name string and non-default school', () => {
    const meta = professorMeta('Ada Lovelace', UNC);
    expect(meta.title).toBe('Ada Lovelace syllabi · University of North Carolina at Chapel Hill');
    expect(meta.description).toContain('Ada Lovelace');
    expect(meta.canonical).toBeUndefined();

    const uncObj = professorMeta({ name: 'Ada Lovelace', slug: 'ada-lovelace', courses: ['unc:COMP110'], offerings: [{}] }, UNC);
    expect(uncObj.canonical).toBe('/professors/ada-lovelace?school=unc');
    expect(uncObj.description).toContain('1 past syllabus');
    expect(uncObj.description).toContain('1 course');
  });
});

describe('courseJsonLd', () => {
  test('builds Course + BreadcrumbList graph without rating markup', () => {
    const ld = courseJsonLd(
      {
        code: 'CS310',
        dept: 'CS',
        display: 'CS 310',
        title: 'Data Structures',
        credits: '3',
        description: 'Trees, graphs, and hashing.',
        prereqs: 'CS 211 with C or better.',
      },
      GMU,
      'https://findmysyllabus.bentruong.dev'
    );

    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@graph']).toHaveLength(2);

    const [courseNode, breadcrumbNode] = ld['@graph'];
    expect(courseNode).toEqual({
      '@type': 'Course',
      name: 'CS 310 Data Structures',
      courseCode: 'CS 310',
      url: 'https://findmysyllabus.bentruong.dev/courses/CS310',
      description: 'Trees, graphs, and hashing.',
      provider: { '@type': 'CollegeOrUniversity', name: 'George Mason University' },
      numberOfCredits: 3,
      coursePrerequisites: 'CS 211 with C or better.',
    });

    expect(breadcrumbNode).toEqual({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'George Mason University', item: 'https://findmysyllabus.bentruong.dev/' },
        { '@type': 'ListItem', position: 2, name: 'CS courses', item: 'https://findmysyllabus.bentruong.dev/?dept=CS' },
        { '@type': 'ListItem', position: 3, name: 'CS 310', item: 'https://findmysyllabus.bentruong.dev/courses/CS310' },
      ],
    });

    const raw = JSON.stringify(ld);
    expect(raw).not.toMatch(/AggregateRating|Review|Rating/i);
  });

  test('builds non-GMU breadcrumbs with school query param and omits non-numeric credits', () => {
    const ld = courseJsonLd(
      { code: 'unc:COMP110', title: 'Intro to Programming', credits: '1-3' },
      UNC,
      'https://example.com/'
    );
    const [courseNode, breadcrumbNode] = ld['@graph'];
    expect(courseNode.numberOfCredits).toBeUndefined();
    expect(breadcrumbNode.itemListElement[0].item).toBe('https://example.com/?school=unc');
    expect(breadcrumbNode.itemListElement[1].item).toBe('https://example.com/?school=unc&dept=COMP');
    expect(breadcrumbNode.itemListElement[2].item).toBe('https://example.com/courses/unc:COMP110');
  });

  test('returns null for missing course', () => {
    expect(courseJsonLd(null, GMU, 'https://example.com')).toBeNull();
  });

  test('escapes < characters when serializing JSON-LD', () => {
    const text = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(text).not.toContain('</script>');
    expect(text).toContain('\\u003c/script>');
  });
});

describe('usePageMeta', () => {
  test('sets title, meta description, OG, Twitter, canonical, and JSON-LD tags and cleans up JSON-LD', () => {
    const jsonLd = courseJsonLd({ code: 'CS310', title: 'Data Structures' }, GMU, 'https://example.com');
    const { rerender, unmount } = render(
      createElement(MetaHarness, {
        meta: {
          title: 'CS 310 Data Structures syllabus · George Mason University',
          description: 'Browse past syllabi for CS 310.',
          canonical: '/courses/CS310',
          jsonLd,
        },
      })
    );

    expect(document.title).toBe('CS 310 Data Structures syllabus · George Mason University');
    expect(document.head.querySelector('meta[name="description"]').getAttribute('content')).toBe(
      'Browse past syllabi for CS 310.'
    );
    expect(document.head.querySelector('meta[property="og:site_name"]').getAttribute('content')).toBe(SITE_NAME);
    expect(document.head.querySelector('meta[property="og:title"]').getAttribute('content')).toBe(
      'CS 310 Data Structures syllabus · George Mason University'
    );
    expect(document.head.querySelector('meta[property="og:description"]').getAttribute('content')).toBe(
      'Browse past syllabi for CS 310.'
    );
    expect(document.head.querySelector('meta[property="og:type"]').getAttribute('content')).toBe('website');
    expect(document.head.querySelector('meta[property="og:url"]').getAttribute('content')).toBe(
      `${window.location.origin}/courses/CS310`
    );
    expect(document.head.querySelector('meta[name="twitter:card"]').getAttribute('content')).toBe('summary');
    expect(document.head.querySelector('meta[name="twitter:title"]').getAttribute('content')).toBe(
      'CS 310 Data Structures syllabus · George Mason University'
    );
    expect(document.head.querySelector('meta[name="twitter:description"]').getAttribute('content')).toBe(
      'Browse past syllabi for CS 310.'
    );
    expect(document.head.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(
      `${window.location.origin}/courses/CS310`
    );

    const script = document.head.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(JSON.parse(script.textContent)['@graph'][0].courseCode).toBe('CS 310');

    // Removing jsonLd clears the script tag
    rerender(createElement(MetaHarness, { meta: { title: 'Professors · George Mason University' } }));
    expect(document.title).toBe('Professors · George Mason University');
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();

    unmount();
  });
});
