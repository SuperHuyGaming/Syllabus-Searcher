import { describe, expect, test } from 'vitest';
import { matchCourses, matchSchools, matchSubjects, subjectSuggestions } from './suggest';

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
  { code: 'ACCT', display: 'ACCT', name: 'Accounting', withSyllabi: 0 },
  { code: 'BIOL', display: 'BIOL', name: 'Biology', withSyllabi: 0 },
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

  test('lists all subjects alphabetically with nothing typed', () => {
    expect(matchSubjects(departments, '').map((d) => d.code)).toEqual(['ACCT', 'BIOL', 'CSI', 'CS', 'ECE', 'MATH', 'SWE']);
  });

  test('still respects the limit while typing', () => {
    expect(matchSubjects(departments, 'comp', 2).map((d) => d.code)).toEqual(['CS', 'CSI']);
  });
});

describe('matchCourses', () => {
  const courses = [
    { code: 'CS3100', display: 'CS 3100', title: 'Honors Data Structures', hasSyllabi: false },
    { code: 'SWE310', display: 'SWE 310', title: 'Seminar on CS310', hasSyllabi: false },
    { code: 'CS310', display: 'CS 310', title: 'Data Structures', hasSyllabi: true },
    { code: 'CS483', display: 'CS 483', title: 'Analysis of Algorithms', hasSyllabi: true },
    { code: 'unc:COMP110', display: 'COMP 110', title: 'Introduction to Programming', hasSyllabi: false },
  ];

  test('accepts CS310, cs 310 and cs-310 and ranks exact code matches first', () => {
    for (const query of ['CS310', 'cs 310', 'cs-310', '  CS - 310  ']) {
      expect(matchCourses(courses, query).map((c) => c.code)).toEqual(['CS310', 'CS3100', 'SWE310']);
    }
  });

  test('matches school-prefixed course codes with or without spaces or hyphens', () => {
    for (const query of ['COMP110', 'comp 110', 'comp-110', 'unc:COMP110']) {
      expect(matchCourses(courses, query).map((c) => c.code)).toEqual(['unc:COMP110']);
    }
  });

  test('matches course titles, ranking word starts before substrings', () => {
    expect(matchCourses(courses, 'data struct').map((c) => c.code)).toEqual(['CS3100', 'CS310']);
    expect(matchCourses(courses, 'algorithms').map((c) => c.code)).toEqual(['CS483']);
    const list = [
      { code: 'CS200', display: 'CS 200', title: 'Bioinformatics', hasSyllabi: false },
      { code: 'CS201', display: 'CS 201', title: 'Formal Methods', hasSyllabi: false },
    ];
    expect(matchCourses(list, 'form').map((c) => c.code)).toEqual(['CS201', 'CS200']);
  });

  test('filters out non-matching courses and returns empty for blank input', () => {
    expect(matchCourses(courses, '')).toEqual([]);
    expect(matchCourses(courses, 'russell')).toEqual([]);
  });

  test('respects limit', () => {
    expect(matchCourses(courses, 'cs', 2).map((c) => c.code)).toEqual(['CS3100', 'CS310']);
  });
});

describe('subjectSuggestions', () => {
  const courses = [
    { code: 'CS3100', display: 'CS 3100', title: 'Honors Data Structures', hasSyllabi: false },
    { code: 'CS310', display: 'CS 310', title: 'Data Structures', hasSyllabi: true },
    { code: 'CS483', display: 'CS 483', title: 'Analysis of Algorithms', hasSyllabi: true },
    { code: 'CS211', display: 'CS 211', title: 'Computer Science Foundations', hasSyllabi: true },
  ];
  const professors = [
    { name: 'Gonzalez Samudio, David', slug: 'gonzalez-samudio-david', courses: ['CS211'] },
    { name: 'Russell, K', slug: 'russell-k', courses: ['CS310', 'CS483'] },
    { name: 'Compston, A', slug: 'compston-a', courses: ['CS112'] },
  ];
  const kinds = (list) => list.map((s) => s.kind);

  test('subjects first for words, then courses, then matching professors', () => {
    const list = subjectSuggestions({ departments, courses, professors, text: 'comp' });
    expect(kinds(list)).toEqual(['Subjects', 'Subjects', 'Subjects', 'Courses', 'Professors']);
    expect(list.at(-1).item.slug).toBe('compston-a');
  });

  test('finds professors by surname or first name', () => {
    for (const query of ['russell', 'Russell', 'gonzalez', 'samudio', 'david']) {
      const list = subjectSuggestions({ departments, courses, professors, text: query });
      expect(kinds(list)).toEqual(['Professors']);
      expect(list.length).toBe(1);
    }
    expect(subjectSuggestions({ departments, courses, professors, text: 'russell' })[0].item.slug).toBe('russell-k');
    expect(subjectSuggestions({ departments, courses, professors, text: 'gonzalez' })[0].item.slug).toBe('gonzalez-samudio-david');
  });

  test('matches course titles', () => {
    const list = subjectSuggestions({ departments, courses, professors, text: 'data structures' });
    expect(kinds(list)).toEqual(['Courses', 'Courses']);
    expect(list.map((s) => s.item.code)).toEqual(['CS3100', 'CS310']);
  });

  test('courses first with exact code match at top for CS310, cs 310 and cs-310', () => {
    for (const query of ['CS310', 'cs 310', 'cs-310']) {
      const list = subjectSuggestions({ departments, courses, professors, text: query });
      expect(kinds(list)).toEqual(['Courses', 'Courses', 'Subjects']);
      expect(list[0].item.code).toBe('CS310');
      expect(list[1].item.code).toBe('CS3100');
      expect(list[2].item.code).toBe('CS');
    }
  });

  test('lists every subject alphabetically before anything is typed', () => {
    const list = subjectSuggestions({ departments, courses, professors, text: '' });
    expect(kinds(list)).toEqual(Array(departments.length).fill('Subjects'));
    expect(list.map((s) => s.item.code)).toEqual(['ACCT', 'BIOL', 'CSI', 'CS', 'ECE', 'MATH', 'SWE']);
  });

  test('keys are unique across kinds', () => {
    const list = subjectSuggestions({ departments, courses, professors, text: 'cs' });
    expect(new Set(list.map((s) => s.key)).size).toBe(list.length);
  });
});
