import { describe, expect, test } from 'vitest';
import { pickDepartment, sortDepartments } from './departments';

const unc = [
  { code: 'unc:AERO', display: 'AERO', name: 'Aerospace Studies', withSyllabi: 0 },
  { code: 'unc:COMP', display: 'COMP', name: 'Computer Science', withSyllabi: 0 },
  { code: 'unc:MATH', display: 'MATH', name: 'Mathematics', withSyllabi: 0 },
];

describe('pickDepartment', () => {
  test('the address wins, read at the current school', () => {
    expect(pickDepartment(unc, 'unc', 'math')).toBe('unc:MATH');
    expect(pickDepartment([], 'gmu', 'MATH')).toBe('MATH');
  });

  test('GMU starts on CS without waiting for its departments', () => {
    expect(pickDepartment([], 'gmu')).toBe('CS');
  });

  test("another school starts on computer science, or where its syllabi are", () => {
    expect(pickDepartment([], 'unc')).toBeNull();
    expect(pickDepartment(unc, 'unc')).toBe('unc:COMP');
    const withOne = unc.map((d) => (d.display === 'MATH' ? { ...d, withSyllabi: 1 } : d));
    expect(pickDepartment(withOne, 'unc')).toBe('unc:MATH');
    expect(pickDepartment([unc[0]], 'unc')).toBe('unc:AERO');
    const gatech = [
      { code: 'gatech:CSE', display: 'CSE', name: 'Computational Science & Engr', withSyllabi: 0 },
      { code: 'gatech:CS', display: 'CS', name: 'Computer Science', withSyllabi: 0 },
    ];
    expect(pickDepartment(gatech, 'gatech')).toBe('gatech:CS');
  });
});

describe('sortDepartments', () => {
  test('departments with syllabi come first, then by name', () => {
    const list = [unc[2], { ...unc[1], withSyllabi: 2 }, unc[0]];
    expect(sortDepartments(list).map((d) => d.display)).toEqual(['COMP', 'AERO', 'MATH']);
  });
});
