const { renameProfessor } = require('../src/lib/rename');

const offering = (code, termKey, termLabel, instructors, extra = {}) => ({
  PK: `COURSE#${code}`,
  SK: `TERM#${termKey}#SEC#001#f-${code}`,
  code,
  title: `${code} title`,
  termKey,
  termLabel,
  section: '001',
  instructors,
  fileId: `f-${code}`,
  sourceUrl: `https://example.edu/${code}.pdf`,
  ...extra,
});

function fakes(found) {
  return {
    catalog: {
      offeringsByInstructor: jest.fn().mockResolvedValue(found),
      updateOffering: jest.fn().mockResolvedValue({}),
      markCurated: jest.fn().mockResolvedValue(),
      offeringsForFile: jest.fn().mockResolvedValue([{ code: 'X' }]),
    },
    search: { refresh: jest.fn().mockResolvedValue() },
  };
}

describe('renameProfessor', () => {
  const found = [
    offering('CS351', '2023-3', 'Fall 2023', ['Yu, L']),
    offering('CS452', '2025-1', 'Spring 2025', ['Yu, L', 'Smith, J'], { sourceUrl: undefined }),
  ];

  test('a dry run lists the changes and writes nothing', async () => {
    const deps = fakes(found);
    const changes = await renameProfessor(deps, 'Yu, L', 'Yu, Craig');
    expect(deps.catalog.offeringsByInstructor).toHaveBeenCalledWith('Yu, L');
    expect(changes).toEqual([
      { code: 'CS351', term: 'Fall 2023', section: '001', before: ['Yu, L'], after: ['Yu, Craig'] },
      { code: 'CS452', term: 'Spring 2025', section: '001', before: ['Yu, L', 'Smith, J'], after: ['Yu, Craig', 'Smith, J'] },
    ]);
    expect(deps.catalog.updateOffering).not.toHaveBeenCalled();
    expect(deps.catalog.markCurated).not.toHaveBeenCalled();
    expect(deps.search.refresh).not.toHaveBeenCalled();
  });

  test('applying rewrites each listing, keeps the scrape from undoing it, and updates search', async () => {
    const deps = fakes(found);
    await renameProfessor(deps, 'Yu, L', 'Yu, Craig', { apply: true, by: 'test' });
    expect(deps.catalog.updateOffering).toHaveBeenCalledWith(found[0], {
      dept: 'CS',
      code: 'CS351',
      title: 'CS351 title',
      term: expect.objectContaining({ key: '2023-3' }),
      section: '001',
      instructors: ['Yu, Craig'],
    });
    expect(deps.catalog.markCurated).toHaveBeenCalledWith('https://example.edu/CS351.pdf', { action: 'edited', by: 'test' });
    expect(deps.search.refresh).toHaveBeenCalledWith('f-CS351', [{ code: 'X' }]);
    expect(deps.search.refresh).toHaveBeenCalledWith('f-CS452', [{ code: 'X' }]);
  });

  test('handles accents and does not list a professor twice', async () => {
    const deps = fakes([offering('CS583', '2025-1', 'Spring 2025', ['González, Ana', 'González Hernández, Ana'])]);
    const [change] = await renameProfessor(deps, 'González, Ana', 'González Hernández, Ana');
    expect(change.after).toEqual(['González Hernández, Ana']);
  });

  test('refuses a bad or unchanged new name', async () => {
    await expect(renameProfessor(fakes([]), 'Yu, L', 'Yu, L')).rejects.toThrow(/same/);
    await expect(renameProfessor(fakes([]), 'Yu, L', '<script>')).rejects.toThrow(/instructor/);
    await expect(renameProfessor(fakes([]), '', 'Yu, Craig')).rejects.toThrow(/current name/);
  });

  test("with a school, only that school's syllabi change", async () => {
    const both = () => [
      offering('CS310', '2024-3', 'Fall 2024', ['Smith, J']),
      offering('unc:COMP110', '2024-3', 'Fall 2024', ['Smith, J']),
    ];
    const deps = fakes(both());
    const gmu = await renameProfessor(deps, 'Smith, J', 'Smith, Jane', { school: 'gmu', apply: true });
    expect(gmu.map((c) => c.code)).toEqual(['CS310']);
    expect(deps.catalog.updateOffering).toHaveBeenCalledTimes(1);

    const unc = await renameProfessor(fakes(both()), 'Smith, J', 'Smith, Jo', { school: 'unc' });
    expect(unc.map((c) => c.code)).toEqual(['unc:COMP110']);

    // The command-line script gives no school and renames everywhere.
    const all = await renameProfessor(fakes(both()), 'Smith, J', 'Smith, Jo');
    expect(all).toHaveLength(2);
  });
});
