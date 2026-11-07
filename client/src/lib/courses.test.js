import { describe, expect, test } from 'vitest';
import { deptOf, deptOfText, displayCourse, normalizeCourse } from './courses';

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

describe('departments', () => {
  test('deptOf reads the letters of a stored code', () => {
    expect(deptOf('CS310')).toBe('CS');
    expect(deptOf('MATH113')).toBe('MATH');
  });

  test('deptOfText reads a half-typed code', () => {
    expect(deptOfText('math 2')).toBe('MATH');
    expect(deptOfText('cs')).toBe('CS');
    expect(deptOfText('CS-310')).toBe('CS');
    expect(deptOfText('Data Structures')).toBeNull();
    expect(deptOfText('c')).toBeNull();
    expect(deptOfText('')).toBeNull();
  });
});
