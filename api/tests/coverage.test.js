const { createCoverage } = require('../src/repos/coverage');

// Minimal MongoDB stand-in for coverage and syllabus_hints collections.
function fakeDb({ coverage = [], hints = [] } = {}) {
  const matchFilter = (doc, filter = {}) => {
    if (filter.$or) return filter.$or.some((sub) => matchFilter(doc, sub));
    for (const [key, cond] of Object.entries(filter)) {
      const value = doc[key];
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if (cond.$in) {
          const matched = cond.$in.some((v) => (v === null ? value === null || value === undefined : value === v));
          if (!matched) return false;
        }
      } else if (value !== cond) {
        return false;
      }
    }
    return true;
  };

  const makeCollection = (rows) => ({
    findOne: jest.fn(async (filter, options) => {
      const found = rows.find((r) => matchFilter(r, filter));
      if (!found) return null;
      if (options?.projection) {
        const projected = {};
        for (const k of Object.keys(options.projection)) {
          if (options.projection[k]) projected[k] = found[k];
        }
        return projected;
      }
      return found;
    }),
    find: jest.fn((filter) => {
      let matched = rows.filter((r) => matchFilter(r, filter));
      return {
        sort(spec) {
          const [[field, dir]] = Object.entries(spec);
          matched = [...matched].sort((a, b) => String(a[field] || '').localeCompare(String(b[field] || '')) * dir);
          return this;
        },
        toArray: async () => matched,
      };
    }),
  });

  const cols = { coverage: makeCollection(coverage), syllabus_hints: makeCollection(hints) };
  return { collection: (name) => cols[name], cols };
}

describe('coverage repo', () => {
  test('returns null when no coverage report has been computed yet', async () => {
    const repo = createCoverage({ db: fakeDb() });
    expect(await repo.getCoverage('gmu')).toBeNull();
  });

  test('returns coverage sorted by most missing courses first', async () => {
    const db = fakeDb({
      coverage: [
        {
          _id: 'gmu',
          school: 'gmu',
          computedAt: '2026-11-28T10:00:00Z',
          totals: { courses: 100, withSyllabi: 40, withoutSyllabi: 60 },
          departments: [
            { dept: 'CS', courses: 30, withSyllabi: 20, withoutSyllabi: 10, missingCourses: ['CS 499'] },
            { dept: 'MATH', courses: 50, withSyllabi: 10, withoutSyllabi: 40, missingCourses: ['MATH 113', 'MATH 114'] },
            { dept: 'ART', courses: 20, withSyllabi: 10, withoutSyllabi: 10, missingCourses: ['ART 101'] },
          ],
        },
      ],
    });
    const report = await createCoverage({ db }).getCoverage('gmu');
    expect(report.computedAt).toBe('2026-11-28T10:00:00Z');
    expect(report.totals).toEqual({ courses: 100, withSyllabi: 40, withoutSyllabi: 60 });
    expect(report.departments.map((d) => d.dept)).toEqual(['MATH', 'ART', 'CS']);
  });

  test('lists hints for a school sorted newest first', async () => {
    const db = fakeDb({
      hints: [
        {
          code: 'CS 310',
          school: 'gmu',
          url: 'https://www.studocu.com/en-us/document/gmu/cs-310',
          title: 'CS 310 Syllabus',
          snippet: 'Data structures syllabus',
          host: 'studocu.com',
          foundAt: '2026-11-20T00:00:00Z',
        },
        {
          code: 'MATH 113',
          school: 'gmu',
          url: 'https://www.coursehero.com/file/12345/',
          title: 'MATH 113 Fall 2025',
          snippet: 'Calculus I',
          host: 'coursehero.com',
          foundAt: '2026-11-25T00:00:00Z',
        },
        {
          code: 'COMP 110',
          school: 'unc',
          url: 'https://www.studocu.com/en-us/document/unc/comp-110',
          title: 'COMP 110',
          snippet: 'Intro',
          host: 'studocu.com',
          foundAt: '2026-11-26T00:00:00Z',
        },
      ],
    });
    const repo = createCoverage({ db });
    const gmuHints = await repo.listHints('gmu');
    expect(gmuHints.map((h) => h.code)).toEqual(['MATH 113', 'CS 310']);
    const uncHints = await repo.listHints('unc');
    expect(uncHints.map((h) => h.code)).toEqual(['COMP 110']);
  });

  test('hasOnlineHint matches both compact and spaced codes and returns only a boolean', async () => {
    const db = fakeDb({
      hints: [
        { _id: '1', code: 'CS 310', school: 'gmu', url: 'https://www.studocu.com/doc/1', host: 'studocu.com' },
        { _id: '2', code: 'MATH113', school: 'gmu', url: 'https://www.coursehero.com/file/2', host: 'coursehero.com' },
        { _id: '3', code: 'COMP 110', school: 'unc', url: 'https://www.studocu.com/doc/3', host: 'studocu.com' },
      ],
    });
    const repo = createCoverage({ db });
    expect(await repo.hasOnlineHint('CS310')).toBe(true);
    expect(await repo.hasOnlineHint('MATH113')).toBe(true);
    expect(await repo.hasOnlineHint('CS483')).toBe(false);
    expect(await repo.hasOnlineHint('unc:COMP110')).toBe(true);
    expect(await repo.hasOnlineHint('unc:COMP210')).toBe(false);
    // Only _id is projected, never URL or snippet.
    expect(db.cols.syllabus_hints.findOne).toHaveBeenCalledWith(expect.any(Object), { projection: { _id: 1 } });
  });
});
