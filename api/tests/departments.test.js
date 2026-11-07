const { createDepartments } = require('../src/repos/departments');

// Just enough of a MongoDB collection for these queries: $regex, $and, sort by _id, limit.
function fakeDb(docs) {
  const matches = (doc, filter) =>
    Object.entries(filter).every(([key, cond]) => {
      if (key === '$and') return cond.every((f) => matches(doc, f));
      if (cond && cond.$regex !== undefined) return new RegExp(cond.$regex, cond.$options).test(doc[key] || '');
      return doc[key] === cond;
    });
  const cursor = (found) => ({
    sort: () => cursor([...found].sort((a, b) => a._id.localeCompare(b._id))),
    limit: (n) => cursor(found.slice(0, n)),
    toArray: async () => found,
  });
  return {
    collection: (name) => ({
      find: (filter) => cursor((docs[name] || []).filter((d) => matches(d, filter))),
      findOne: async (filter) => (docs[name] || []).find((d) => matches(d, filter)) || null,
    }),
  };
}

const courses = [
  { _id: 'CS310', dept: 'CS', title: 'Data Structures' },
  { _id: 'CS583', dept: 'CS', title: 'Analysis of Algorithms' },
  { _id: 'CSI300', dept: 'CSI', title: 'Data Science Methods' },
  { _id: 'MATH203', dept: 'MATH', title: 'Linear Algebra' },
  { _id: 'MATH213', dept: 'MATH', title: 'Analytic Geometry and Calculus III' },
];
const departments = createDepartments({ db: fakeDb({ courses, departments: [{ _id: 'MATH', name: 'Mathematics' }] }) });
const codes = (list) => list.map((c) => c.code);

describe('course search over the catalog', () => {
  test('a code prefix finds that department, in any spelling', async () => {
    expect(codes(await departments.search('math 2'))).toEqual(['MATH203', 'MATH213']);
    expect(codes(await departments.search('cs-31'))).toEqual(['CS310']);
  });

  test('a department code lists its own courses before longer codes', async () => {
    expect(codes(await departments.search('CS'))).toEqual(['CS310', 'CS583', 'CSI300']);
  });

  test('title words match in any order, ignoring case', async () => {
    expect(codes(await departments.search('structures DATA'))).toEqual(['CS310']);
    expect(codes(await departments.search('data'))).toEqual(['CS310', 'CSI300']);
  });

  test('regex characters in the query are plain text', async () => {
    expect(await departments.search('(.*')).toEqual([]);
  });

  test('part of a word matches, like a prefix of Analysis', async () => {
    expect(codes(await departments.search('anal'))).toEqual(['CS583', 'MATH213']);
  });
});

describe('departments', () => {
  test('CS is always covered, others once the catalog has them', async () => {
    expect(await departments.exists('CS')).toBe(true);
    expect(await departments.exists('MATH')).toBe(true);
    expect(await departments.exists('XYZ')).toBe(false);
  });
});
