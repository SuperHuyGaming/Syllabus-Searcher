const { snippet, terms, schoolFilter } = require('../src/repos/search');

describe('search helpers', () => {
  test('terms keep phrases and drop negations and tiny words', () => {
    expect(terms('"data structures" -java a python')).toEqual(['data structures', 'python']);
  });

  test('snippet matches whole words and phrases, not parts of words', () => {
    const text = `The related work section comes first. ${'filler '.repeat(60)}Late policy: 10% off per day.`;
    expect(snippet(text, ['late policy'])).toContain('Late policy: 10%');
    expect(snippet(text, ['late'])).toContain('Late policy');
  });

  test('snippet centers on the first match', () => {
    const text = `${'intro '.repeat(100)}We will use Python 3 for every assignment. ${'outro '.repeat(100)}`;
    const result = snippet(text, ['python']);
    expect(result).toContain('Python 3');
    expect(result.startsWith('…')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(245);
  });

  test('snippet falls back to the word stem', () => {
    expect(snippet('Students learn programming in C.', ['programs'])).toContain('programming');
  });

  test('snippet starts at the top when nothing matches', () => {
    expect(snippet('Course overview and goals', ['zzz'])).toBe('Course overview and goals');
  });
});

describe('search per school', () => {
  test('GMU means codes without a school prefix', () => {
    const { codes } = schoolFilter('gmu');
    expect(codes.$not.test('CS310')).toBe(false);
    expect(codes.$not.test('unc:COMP110')).toBe(true);
  });

  test('other schools match their prefix', () => {
    expect(schoolFilter('unc')).toEqual({ codes: { $regex: '^unc:' } });
  });
});
