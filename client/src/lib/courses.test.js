import { describe, expect, test } from 'vitest';
import { displayCourse, normalizeCourse } from './courses';

describe('normalizeCourse', () => {
  test('accepts spaced, dashed and lowercase codes', () => {
    expect(normalizeCourse('cs 584')).toBe('CS584');
    expect(normalizeCourse('CS-310')).toBe('CS310');
    expect(normalizeCourse(' cs110 ')).toBe('CS110');
  });

  test('rejects anything else', () => {
    expect(normalizeCourse('CS')).toBeNull();
    expect(normalizeCourse('Data Mining')).toBeNull();
    expect(normalizeCourse('')).toBeNull();
  });
});

test('displayCourse adds the space back', () => {
  expect(displayCourse('CS584')).toBe('CS 584');
});
