const { groupByProfessor, professorSlug } = require('../src/lib/professors');

const offering = (code, termKey, instructors, section = '001') => ({
  code,
  termKey,
  section,
  instructors,
  fileId: `${code}-${termKey}-${section}`,
});

describe('professors', () => {
  test('slugs are URL safe', () => {
    expect(professorSlug('Zaman, A')).toBe('zaman-a');
    expect(professorSlug('Gonzalez Hernández, A')).toBe('gonzalez-hernandez-a');
    expect(professorSlug("O'Neil")).toBe('o-neil');
  });

  test('groups offerings by professor, newest term first', () => {
    const [chen, otten] = groupByProfessor([
      offering('CS451', '2022-3', ['Chen, J']),
      offering('CS551', '2023-1', ['Chen, J']),
      offering('CS110', '2023-1', ['Otten', 'Chen, J']),
    ]);
    expect(chen.name).toBe('Chen, J');
    expect(chen.courses).toEqual(['CS110', 'CS451', 'CS551']);
    expect(chen.offerings.map((o) => o.code)).toEqual(['CS110', 'CS551', 'CS451']);
    expect(chen.offerings[0].coInstructors).toEqual(['Otten']);
    expect(otten.slug).toBe('otten');
  });

  test('skips placeholder names', () => {
    expect(groupByProfessor([offering('CS112', '2023-1', ['All instructors', 'All Professors', 'Staff'])])).toEqual([]);
  });

  test('merges a bare surname into the one matching "Surname, Initial"', () => {
    const professors = groupByProfessor([
      offering('CS100', '2023-1', ['Abdelmoumin, G']),
      offering('CS112', '2022-3', ['Abdelmoumin', 'Zaman, A']),
    ]);
    expect(professors.map((p) => p.name)).toEqual(['Abdelmoumin, G', 'Zaman, A']);
    expect(professors[0].courses).toEqual(['CS100', 'CS112']);
  });

  test('leaves a bare surname alone when it is ambiguous', () => {
    const names = groupByProfessor([
      offering('CS451', '2023-1', ['Chen, J']),
      offering('CS571', '2023-1', ['Chen, S']),
      offering('CS110', '2023-1', ['Chen']),
    ]).map((p) => p.name);
    expect(names).toEqual(['Chen', 'Chen, J', 'Chen, S']);
  });
});
