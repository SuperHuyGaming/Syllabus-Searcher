import { describe, expect, test } from 'vitest';
import { catalogCourseUrl, rateMyProfessorsUrl, removalRequestUrl, rmpSearchQuery } from './links';

describe('catalogCourseUrl', () => {
  test('builds GMU catalog search URL for bare GMU course codes', () => {
    expect(catalogCourseUrl('CS310')).toBe('https://catalog.gmu.edu/search/?P=CS+310');
    expect(catalogCourseUrl('MATH113')).toBe('https://catalog.gmu.edu/search/?P=MATH+113');
  });

  test('builds school-specific catalog URLs for other supported schools', () => {
    expect(catalogCourseUrl('unc:COMP110')).toBe('https://catalog.unc.edu/search/?P=COMP+110');
    expect(catalogCourseUrl('gatech:CS1331')).toBe('https://catalog.gatech.edu/search/?P=CS+1331');
    expect(catalogCourseUrl('odu:CS150')).toBe('https://catalog.odu.edu/search/?P=CS+150');
  });

  test('returns null for unknown schools or empty codes', () => {
    expect(catalogCourseUrl('unknown:CS101')).toBeNull();
    expect(catalogCourseUrl('')).toBeNull();
    expect(catalogCourseUrl(null)).toBeNull();
  });
});

describe('rmpSearchQuery & rateMyProfessorsUrl', () => {
  test('reorders Last, First names and simplifies single initials', () => {
    expect(rmpSearchQuery('Snyder, Mark')).toBe('Mark Snyder');
    expect(rmpSearchQuery('Kamberi, S')).toBe('Kamberi');
    expect(rmpSearchQuery('Kamberi, S.')).toBe('Kamberi');
    expect(rmpSearchQuery('Mark Snyder')).toBe('Mark Snyder');
  });

  test('returns null for placeholder instructor names', () => {
    expect(rateMyProfessorsUrl('Staff', 'gmu')).toBeNull();
    expect(rateMyProfessorsUrl('TBA', 'gmu')).toBeNull();
    expect(rateMyProfessorsUrl('All Instructors', 'gmu')).toBeNull();
    expect(rateMyProfessorsUrl('', 'gmu')).toBeNull();
  });

  test('uses school ID 362 for GMU and general RMP search for other schools', () => {
    expect(rateMyProfessorsUrl('Snyder, Mark', 'gmu')).toBe(
      'https://www.ratemyprofessors.com/search/professors/362?q=Mark%20Snyder'
    );
    expect(rateMyProfessorsUrl('Snyder, Mark')).toBe(
      'https://www.ratemyprofessors.com/search/professors/362?q=Mark%20Snyder'
    );
    expect(rateMyProfessorsUrl('Jordan, Kris', 'unc')).toBe(
      'https://www.ratemyprofessors.com/search/professors?q=Kris%20Jordan'
    );
  });
});

describe('removalRequestUrl', () => {
  test('prefills subject and body with course, term, section, instructor, and syllabus IDs', () => {
    const url = removalRequestUrl(
      {
        code: 'CS310',
        display: 'CS 310',
        termLabel: 'Fall 2025',
        section: '001',
        instructors: ['Snyder, Mark'],
        fileId: '507f1f77bcf86cd799439011',
        id: 'TERM#2025-3#SEC#001#507f1f77bcf86cd799439011',
      },
      'takedown@example.com'
    );
    expect(url.startsWith('mailto:takedown@example.com?subject=')).toBe(true);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('subject=Syllabus removal request: CS 310 (Fall 2025)');
    expect(decoded).toContain('Course: CS 310 (CS310)');
    expect(decoded).toContain('Term: Fall 2025');
    expect(decoded).toContain('Section: 001');
    expect(decoded).toContain('Instructor: Snyder, Mark');
    expect(decoded).toContain('Syllabus file ID: 507f1f77bcf86cd799439011');
    expect(decoded).toContain('Offering ID: TERM#2025-3#SEC#001#507f1f77bcf86cd799439011');
  });

  test('handles minimal offering metadata gracefully', () => {
    const url = removalRequestUrl({ code: 'unc:COMP110' }, 'takedown@example.com');
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('subject=Syllabus removal request: COMP 110 (Unknown term)');
    expect(decoded).toContain('Course: COMP 110 (unc:COMP110)');
  });
});
