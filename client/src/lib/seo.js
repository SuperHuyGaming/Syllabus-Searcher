import { useEffect } from 'react';
import { DEFAULT_SCHOOL, deptOf, deptPath, displayCourse, schoolOf, withoutSchool } from './courses';
import { professorPath } from './professors';

export const SITE_NAME = 'GMU Syllabus Searcher';
export const DEFAULT_TITLE = SITE_NAME;
export const DEFAULT_DESCRIPTION =
  'Find past GMU and university course syllabi by course, term, and professor, or search inside syllabi.';

const JSONLD_ATTR = 'data-seo-jsonld';

function truncate(text, max = 160) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:!?-]+$/, '')}…`;
}

// Escape "<" so a course description containing "</script>" can never break out of the script tag.
export function serializeJsonLd(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function resolveUrl(canonical, origin) {
  if (!canonical) {
    if (typeof window !== 'undefined' && window.location?.href) return window.location.href;
    return '';
  }
  if (/^https?:\/\//i.test(canonical)) return canonical;
  const base = (origin || (typeof window !== 'undefined' ? window.location?.origin : '') || '').replace(/\/$/, '');
  const path = canonical.startsWith('/') ? canonical : `/${canonical}`;
  return base ? `${base}${path}` : path;
}

function setMeta(attr, key, content) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!content) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!href) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setJsonLd(serialized) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`script[${JSONLD_ATTR}="true"]`);
  if (!serialized) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('script');
    el.setAttribute('type', 'application/ld+json');
    el.setAttribute(JSONLD_ATTR, 'true');
    document.head.appendChild(el);
  }
  el.textContent = serialized;
}

/**
 * Updates document <title>, meta description, Open Graph, Twitter Card,
 * canonical <link>, and optional JSON-LD <script> tags.
 */
export function usePageMeta({ title, description, canonical, type = 'website', jsonLd } = {}) {
  const jsonLdText = jsonLd ? serializeJsonLd(jsonLd) : '';

  useEffect(() => {
    const resolvedTitle = title || DEFAULT_TITLE;
    const resolvedDesc = description ? truncate(description) : DEFAULT_DESCRIPTION;
    const resolvedUrl = resolveUrl(canonical);

    document.title = resolvedTitle;
    setMeta('name', 'description', resolvedDesc);
    setMeta('property', 'og:site_name', SITE_NAME);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:title', resolvedTitle);
    setMeta('property', 'og:description', resolvedDesc);
    setMeta('property', 'og:url', resolvedUrl);
    setMeta('name', 'twitter:card', 'summary');
    setMeta('name', 'twitter:title', resolvedTitle);
    setMeta('name', 'twitter:description', resolvedDesc);
    setCanonical(resolvedUrl);
    setJsonLd(jsonLdText);

    return () => {
      if (jsonLdText) setJsonLd('');
    };
  }, [title, description, canonical, type, jsonLdText]);
}

/**
 * Builds page metadata for a course page, e.g.
 * "CS 310 Data Structures syllabus · George Mason University".
 */
export function courseMeta(course, school) {
  if (!course) return { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION };
  const schoolName = school?.name || 'George Mason University';
  const display = course.display || displayCourse(course.code || '');
  const title = course.title ? `${display} ${course.title} syllabus · ${schoolName}` : `${display} syllabus · ${schoolName}`;

  const count = Array.isArray(course.offerings) ? course.offerings.length : 0;
  let description;
  if (count > 0) {
    const lead = `Browse ${count} past ${display} ${count === 1 ? 'syllabus' : 'syllabi'} at ${schoolName}.`;
    description = course.description ? `${lead} ${course.description}` : `${lead} Filter by term and professor.`;
  } else if (course.description) {
    description = `${display}${course.title ? ` ${course.title}` : ''} at ${schoolName}. ${course.description}`;
  } else {
    description = `${display}${course.title ? ` ${course.title}` : ''} at ${schoolName}. View course details or upload a syllabus.`;
  }

  return {
    title,
    description: truncate(description),
    canonical: course.code ? `/courses/${course.code}` : undefined,
    type: 'website',
  };
}

/**
 * Builds page metadata for a professor page.
 * Accepts either a professor object ({ name, slug, courses, offerings }) or a name string.
 */
export function professorMeta(professor, school) {
  if (!professor) return { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION };
  const schoolName = school?.name || 'George Mason University';
  const schoolKey = school?.key || DEFAULT_SCHOOL;
  const isObj = typeof professor === 'object';
  const name = isObj ? professor.name : String(professor);
  const title = `${name} syllabi · ${schoolName}`;

  let description;
  if (isObj && Array.isArray(professor.offerings)) {
    const syllabi = professor.offerings.length;
    const courses = Array.isArray(professor.courses) ? professor.courses.length : 0;
    description = `View ${syllabi} past ${syllabi === 1 ? 'syllabus' : 'syllabi'} taught by ${name}${
      courses > 0 ? ` across ${courses} ${courses === 1 ? 'course' : 'courses'}` : ''
    } at ${schoolName}.`;
  } else {
    description = `View past course syllabi taught by ${name} at ${schoolName}.`;
  }

  return {
    title,
    description: truncate(description),
    canonical: isObj && professor.slug ? professorPath(professor.slug, schoolKey) : undefined,
    type: 'profile',
  };
}

/**
 * Builds Schema.org Course + BreadcrumbList JSON-LD for a course page.
 * Intentionally omits any AggregateRating, Review, or Rating markup.
 */
export function courseJsonLd(course, school, origin) {
  if (!course || !course.code) return null;
  const schoolKey = school?.key || schoolOf(course.code);
  const schoolName = school?.name || 'George Mason University';
  const display = course.display || displayCourse(course.code);
  const dept = course.dept || deptOf(course.code);
  const deptBare = withoutSchool(dept);
  const base = (origin || (typeof window !== 'undefined' ? window.location?.origin : '') || '').replace(/\/$/, '');
  const homeHref = schoolKey === DEFAULT_SCHOOL ? '/' : `/?school=${schoolKey}`;
  const deptHref = deptPath(dept);
  const courseHref = `/courses/${course.code}`;

  const courseNode = {
    '@type': 'Course',
    name: course.title ? `${display} ${course.title}` : display,
    courseCode: display,
    url: `${base}${courseHref}`,
    description: truncate(
      course.description || `${display}${course.title ? ` ${course.title}` : ''} syllabi and course details at ${schoolName}.`,
      300
    ),
    provider: {
      '@type': 'CollegeOrUniversity',
      name: schoolName,
    },
  };

  if (course.credits && /^\d+(\.\d+)?$/.test(String(course.credits).trim())) {
    courseNode.numberOfCredits = Number(String(course.credits).trim());
  }
  if (course.prereqs) {
    courseNode.coursePrerequisites = course.prereqs;
  }

  const breadcrumbNode = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: schoolName,
        item: `${base}${homeHref}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: `${deptBare} courses`,
        item: `${base}${deptHref}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: display,
        item: `${base}${courseHref}`,
      },
    ],
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [courseNode, breadcrumbNode],
  };
}
