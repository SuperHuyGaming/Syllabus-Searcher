const { parseTerm, normalizeCourse, displayCourse, schoolOf, deptOf, deptKey, withoutSchool } = require('../src/lib/terms');

describe('parseTerm', () => {
  test.each([
    ['Fall 2022', '2022-3', 'Fall 2022'],
    ['spring2023', '2023-1', 'Spring 2023'],
    ['Summer-2024', '2024-2', 'Summer 2024'],
    ['2025-3', '2025-3', 'Fall 2025'],
  ])('%s', (input, key, label) => {
    expect(parseTerm(input)).toMatchObject({ key, label });
  });

  test('rejects nonsense', () => {
    expect(parseTerm('Winter 2022')).toBeNull();
    expect(parseTerm('2022-4')).toBeNull();
    expect(parseTerm('')).toBeNull();
  });

  test('keys sort newest first', () => {
    const keys = ['Fall 2022', 'Spring 2023', 'Summer 2022'].map((t) => parseTerm(t).key).sort().reverse();
    expect(keys).toEqual(['2023-1', '2022-3', '2022-2']);
  });
});

describe('course codes', () => {
  test.each(['CS 310', 'cs310', 'CS-310', ' cs 310 '])('%s normalizes to CS310', (input) => {
    expect(normalizeCourse(input)).toBe('CS310');
  });

  test('rejects bad codes', () => {
    expect(normalizeCourse('310')).toBeNull();
    expect(normalizeCourse('CS 31')).toBeNull();
  });

  test('displays with a space', () => {
    expect(displayCourse('CS310')).toBe('CS 310');
  });
});

describe('school-qualified course codes', () => {
  test('GMU codes stay bare, other schools carry a prefix', () => {
    expect(normalizeCourse('cs 310', 'gmu')).toBe('CS310');
    expect(normalizeCourse('comp 110', 'unc')).toBe('unc:COMP110');
    expect(normalizeCourse('CS 1301', 'gatech')).toBe('gatech:CS1301');
    expect(normalizeCourse('CS 1301R', 'gatech')).toBe('gatech:CS1301R');
  });

  test('a typed school prefix wins, and gmu: is dropped', () => {
    expect(normalizeCourse('unc:COMP 110')).toBe('unc:COMP110');
    expect(normalizeCourse('UNC: comp-110', 'gmu')).toBe('unc:COMP110');
    expect(normalizeCourse('gmu:CS310', 'unc')).toBe('CS310');
  });

  test('rejects malformed codes and schools', () => {
    expect(normalizeCourse('CS 31', 'unc')).toBeNull();
    expect(normalizeCourse('CS 31010', 'unc')).toBeNull();
    expect(normalizeCourse('CS 310', 'bad school')).toBeNull();
    expect(normalizeCourse('a:CS 310')).toBeNull();
  });

  test('splits codes into school, department and display', () => {
    expect(schoolOf('unc:COMP110')).toBe('unc');
    expect(schoolOf('CS310')).toBe('gmu');
    expect(schoolOf('unc:COMP')).toBe('unc');
    expect(deptOf('unc:COMP110')).toBe('unc:COMP');
    expect(deptOf('CS310')).toBe('CS');
    expect(withoutSchool('unc:COMP')).toBe('COMP');
    expect(deptKey('comp', 'unc')).toBe('unc:COMP');
    expect(deptKey('CS', 'gmu')).toBe('CS');
    expect(displayCourse('unc:COMP110')).toBe('COMP 110');
    expect(displayCourse('gatech:CS1301')).toBe('CS 1301');
  });
});
