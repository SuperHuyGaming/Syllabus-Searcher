const { parseTerm, normalizeCourse, displayCourse } = require('../src/lib/terms');

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
