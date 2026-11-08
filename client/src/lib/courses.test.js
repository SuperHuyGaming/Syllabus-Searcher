import { describe, expect, test } from 'vitest';
import { deptKey, deptOf, deptOfText, deptPath, displayCourse, normalizeCourse, schoolOf, withoutSchool } from './courses';

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

describe('schools', () => {
  test('codes from other schools carry their prefix, GMU stays bare', () => {
    expect(normalizeCourse('comp 110', 'unc')).toBe('unc:COMP110');
    expect(normalizeCourse('cs 1301', 'gatech')).toBe('gatech:CS1301');
    expect(normalizeCourse('cs 310', 'gmu')).toBe('CS310');
    expect(normalizeCourse('unc:COMP 110')).toBe('unc:COMP110');
    expect(normalizeCourse('gmu:cs310', 'unc')).toBe('CS310');
  });

  test('splitting and showing codes', () => {
    expect(schoolOf('unc:COMP110')).toBe('unc');
    expect(schoolOf('CS310')).toBe('gmu');
    expect(withoutSchool('unc:COMP')).toBe('COMP');
    expect(displayCourse('unc:COMP110')).toBe('COMP 110');
    expect(deptOf('unc:COMP110')).toBe('unc:COMP');
    expect(deptKey('comp', 'unc')).toBe('unc:COMP');
    expect(deptKey('CS')).toBe('CS');
    expect(deptOfText('comp 11')).toBe('COMP');
    expect(deptOfText('cs 1301')).toBe('CS');
  });

  test('department links keep the school in the address', () => {
    expect(deptPath('CS')).toBe('/?dept=CS');
    expect(deptPath('unc:COMP')).toBe('/?school=unc&dept=COMP');
  });
});
