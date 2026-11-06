const { rollupSources, rollupAction, rollupCourse, MAX_SOURCES } = require('../src/lib/rollup');

const offering = (fileId, termKey, extra = {}) => ({
  fileId,
  termKey,
  termLabel: `Term ${termKey}`,
  section: '001',
  instructors: [`Prof ${fileId}`],
  ...extra,
});
const record = (overview, generatedAt = '2026-11-02T00:00:00Z', extra = {}) => ({ summary: { overview }, generatedAt, ...extra });

describe('rollupSources', () => {
  test('takes one entry per summarized file, newest term first', () => {
    const summaries = new Map([
      ['a', record('A')],
      ['b', record('B', '2026-11-02T00:00:00Z', { editedAt: '2026-11-04T00:00:00Z' })],
    ]);
    const sources = rollupSources(
      [offering('a', '2023-1'), offering('b', '2024-3'), offering('b', '2024-3', { section: '002' }), offering('c', '2025-1')],
      summaries
    );
    expect(sources.map((s) => s.fileId)).toEqual(['b', 'a']);
    expect(sources[0]).toEqual(
      expect.objectContaining({ label: 'Term 2024-3, Prof b', summary: { overview: 'B' }, changedAt: '2026-11-04T00:00:00Z' })
    );
  });

  test('keeps at most the newest few', () => {
    const list = Array.from({ length: 20 }, (_, i) => offering(`f${i}`, `20${10 + i}-1`));
    const summaries = new Map(list.map((o) => [o.fileId, record(o.fileId)]));
    const sources = rollupSources(list, summaries);
    expect(sources).toHaveLength(MAX_SOURCES);
    expect(sources[0].fileId).toBe('f19');
  });
});

describe('rollupAction', () => {
  const sources = [
    { fileId: 'a', changedAt: '2026-11-01T00:00:00Z' },
    { fileId: 'b', changedAt: '2026-11-02T00:00:00Z' },
  ];
  const saved = { fileIds: ['b', 'a'], generatedAt: '2026-11-03T00:00:00Z' };

  test('builds a missing rollup and keeps an up-to-date one', () => {
    expect(rollupAction(null, sources)).toBe('build');
    expect(rollupAction(saved, sources)).toBe('keep');
  });

  test('rebuilds when the syllabi changed or a summary is newer', () => {
    expect(rollupAction(saved, [...sources, { fileId: 'c', changedAt: '' }])).toBe('build');
    expect(rollupAction(saved, [sources[0], { fileId: 'b', changedAt: '2026-11-05T00:00:00Z' }])).toBe('build');
  });

  test('removes a rollup once fewer than two syllabi are left', () => {
    expect(rollupAction(saved, sources.slice(0, 1))).toBe('delete');
    expect(rollupAction(null, [])).toBe('keep');
  });
});

describe('rollupCourse', () => {
  const course = { code: 'CS310', display: 'CS 310', title: 'Data Structures' };
  const sources = [
    { fileId: 'a', label: 'x', summary: {} },
    { fileId: 'b', label: 'y', summary: {} },
  ];

  test('saves the rollup with the files it was made from', async () => {
    const catalog = { putRollup: jest.fn() };
    const summarize = jest.fn().mockResolvedValue({ rollup: { overview: 'o' }, provider: 'Gemini', model: 'm', generatedAt: 't' });
    const saved = await rollupCourse({ catalog, course, sources, summarize });
    expect(summarize).toHaveBeenCalledWith(course, sources, { timeoutMs: undefined });
    expect(catalog.putRollup).toHaveBeenCalledWith('CS310', {
      rollup: { overview: 'o' },
      provider: 'Gemini',
      model: 'm',
      generatedAt: 't',
      fileIds: ['a', 'b'],
    });
    expect(saved.fileIds).toEqual(['a', 'b']);
  });

  test('saves nothing when the AI is unavailable', async () => {
    const catalog = { putRollup: jest.fn() };
    const summarize = jest.fn().mockResolvedValue({ unavailable: 'Gemini free quota used up.' });
    expect(await rollupCourse({ catalog, course, sources, summarize })).toEqual({ unavailable: 'Gemini free quota used up.' });
    expect(catalog.putRollup).not.toHaveBeenCalled();
  });
});
