import { describe, expect, test } from 'vitest';
import { findProfessor, professorSlug, matchProfessors, likelySpellings } from './professors';

describe('professors', () => {
  test('slugs match the API', () => {
    expect(professorSlug('Zaman, A')).toBe('zaman-a');
    expect(professorSlug('González, A')).toBe('gonzalez-a');
  });

  test('finds a merged surname', () => {
    const list = [{ slug: 'kamberi-s' }, { slug: 'chen-j' }, { slug: 'chen-s' }];
    expect(findProfessor(list, 'kamberi')).toEqual({ slug: 'kamberi-s' });
    expect(findProfessor(list, 'chen-j')).toEqual({ slug: 'chen-j' });
    expect(findProfessor(list, 'chen')).toBeNull();
  });
});

describe('matchProfessors', () => {
  const professors = [
    { name: 'Gonzalez Samudio, David', slug: 'gonzalez-samudio-david' },
    { name: 'González, Ana', slug: 'gonzalez-ana' },
    { name: 'Davis, Mark', slug: 'davis-mark' },
    { name: 'Zhu, Ziwei', slug: 'zhu-ziwei' },
  ];
  const names = (q) => matchProfessors(professors, q).map((p) => p.name);

  test('finds a professor by first name, last name or second surname', () => {
    expect(names('ziwei')).toEqual(['Zhu, Ziwei']);
    expect(names('zhu')).toEqual(['Zhu, Ziwei']);
    expect(names('samudio')).toEqual(['Gonzalez Samudio, David']);
  });

  test('matches word starts, ignoring accents and order', () => {
    expect(names('gonz')).toEqual(['Gonzalez Samudio, David', 'González, Ana']);
    expect(names('david gonz')).toEqual(['Gonzalez Samudio, David']);
    expect(names('ana gonzalez')).toEqual(['González, Ana']);
  });

  test('lists surname matches before first-name matches', () => {
    expect(names('dav')).toEqual(['Davis, Mark', 'Gonzalez Samudio, David']);
  });

  test('an empty search lists everyone, up to the limit', () => {
    expect(matchProfessors(professors, '  ', 2)).toHaveLength(2);
  });
});

describe('likelySpellings', () => {
  test('groups spellings that share a surname, fullest name first', () => {
    const names = ['Gonzalez Hernandez, A', 'González, Ana', 'Zhu, Z', 'Chen, J', 'Chen, Songqing', 'Staff', 'All Instructors', 'Kamberi'];
    expect(likelySpellings(names)).toEqual([
      ['Chen, Songqing', 'Chen, J'],
      ['González, Ana', 'Gonzalez Hernandez, A'],
    ]);
  });

  test('a single spelling is not a group', () => {
    expect(likelySpellings(['Zhu, Ziwei', 'Yu, Craig'])).toEqual([]);
  });
});
