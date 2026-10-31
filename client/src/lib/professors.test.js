import { describe, expect, test } from 'vitest';
import { findProfessor, professorSlug } from './professors';

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
