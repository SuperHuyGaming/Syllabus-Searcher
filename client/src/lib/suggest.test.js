import { describe, expect, test } from 'vitest';
import { matchSchools, matchSubjects, subjectSuggestions } from './suggest';

const schools = [
  { key: 'gmu', name: 'George Mason University', short: 'GMU', city: 'Fairfax, VA' },
  { key: 'gatech', name: 'Georgia Institute of Technology', short: 'Georgia Tech', city: 'Atlanta, GA' },
  { key: 'unc', name: 'University of North Carolina at Chapel Hill', short: 'UNC', city: 'Chapel Hill, NC' },
];

const departments = [
  { code: 'CS', display: 'CS', name: 'Computer Science', withSyllabi: 52 },
  { code: 'SWE', display: 'SWE', name: 'Software Engineering', withSyllabi: 14 },
  { code: 'CSI', display: 'CSI', name: 'Computational and Data Sciences', withSyllabi: 0 },
  { code: 'MATH', display: 'MATH', name: 'Mathematics', withSyllabi: 0 },
  { code: 'ECE', display: 'ECE', name: 'Electrical and Computer Engineering', withSyllabi: 0 },
];

describe('matchSchools', () => {
  test('lists every school before anything is typed', () => {
    expect(matchSchools(schools, '').map((s) => s.key)).toEqual(['gmu', 'gatech', 'unc']);
  });

  test('matches name words, short name, key and city', () => {
    expect(matchSchools(schools, 'mason').map((s) => s.key)).toEqual(['gmu']);
    expect(matchSchools(schools, 'north car').map((s) => s.key)).toEqual(['unc']);
    expect(matchSchools(schools, 'georgia tech').map((s) => s.key)).toEqual(['gatech']);
    expect(matchSchools(schools, 'fairfax').map((s) => s.key)).toEqual(['gmu']);
    expect(matchSchools(schools, 'GMU').map((s) => s.key)).toEqual(['gmu']);
    expect(matchSchools(schools, 'geo').map((s) => s.key)).toEqual(['gmu', 'gatech']);
  });

  test('finds nothing for an unknown school', () => {
    expect(matchSchools(schools, 'harvard')).toEqual([]);
  });
});

describe('matchSubjects', () => {
  test('an exact code comes before codes and names that start with it', () => {
    expect(matchSubjects(departments, 'cs').map((d) => d.code)).toEqual(['CS', 'CSI']);
    expect(matchSubjects(departments, 'comp').map((d) => d.code)).toEqual(['CS', 'CSI', 'ECE']);
  });

  test('matches words of the name', () => {
    expect(matchSubjects(departments, 'comp sci').map((d) => d.code)).toEqual(['CS', 'CSI']);
    expect(matchSubjects(departments, 'engineering').map((d) => d.code)).toEqual(['SWE', 'ECE']);
  });

  test('a course code offers its department only', () => {
    expect(matchSubjects(departments, 'cs 310').map((d) => d.code)).toEqual(['CS']);
    expect(matchSubjects(departments, 'math113').map((d) => d.code)).toEqual(['MATH']);
  });

  test('shows the first few with nothing typed', () => {
    expect(matchSubjects(departments, '', 2).map((d) => d.code)).toEqual(['CS', 'SWE']);
  });
});

describe('subjectSuggestions', () => {
  const courses = [{ code: 'CS310', display: 'CS 310', title: 'Data Structures', hasSyllabi: true }];
  const professors = [{ name: 'Gonzalez Samudio, David', slug: 'gonzalez-samudio-david', courses: ['CS211'] }];
  const kinds = (list) => list.map((s) => s.kind);

  test('subjects first for words, with matching professors last', () => {
    const list = subjectSuggestions({ departments, courses, professors, text: 'david' });
    expect(kinds(list)).toEqual(['Courses', 'Professors']);
    expect(list[1].item.slug).toBe('gonzalez-samudio-david');
  });

  test('courses first when the text has a number, and no professors', () => {
    expect(kinds(subjectSuggestions({ departments, courses, professors, text: 'cs 310' }))).toEqual(['Courses', 'Subjects']);
  });

  test('only subjects before anything is typed', () => {
    expect(kinds(subjectSuggestions({ departments, courses, professors, text: '' }))).toEqual(Array(5).fill('Subjects'));
  });

  test('keys are unique across kinds', () => {
    const list = subjectSuggestions({ departments, courses, professors, text: 'cs' });
    expect(new Set(list.map((s) => s.key)).size).toBe(list.length);
  });
});
