import { describe, expect, test } from 'vitest';
import { groupByTerm, instructorsOf, recentTerms, termLabel } from './terms';

describe('terms', () => {
  test('labels keys', () => {
    expect(termLabel('2022-3')).toBe('Fall 2022');
    expect(termLabel('2023-1')).toBe('Spring 2023');
  });

  test('lists recent terms back to Fall 2022', () => {
    const terms = recentTerms(new Date(2023, 9, 1)).map((t) => t.label);
    expect(terms).toEqual(['Fall 2023', 'Summer 2023', 'Spring 2023', 'Fall 2022']);
  });

  test('groups offerings newest term first', () => {
    const groups = groupByTerm([
      { termKey: '2022-3', section: '002', instructors: ['B'] },
      { termKey: '2023-1', section: '001', instructors: ['A'] },
      { termKey: '2022-3', section: '001', instructors: ['A'] },
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Spring 2023', 'Fall 2022']);
    expect(groups[1].offerings.map((o) => o.section)).toEqual(['001', '002']);
  });

  test('collects instructors', () => {
    expect(instructorsOf([{ instructors: ['B', 'A'] }, { instructors: ['A'] }])).toEqual(['A', 'B']);
  });
});
