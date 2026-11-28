import { describe, expect, test } from 'vitest';
import { isArchiveUrl, monthYearLabel, provenanceLabel, provenanceOf, sourceHost } from './provenance';

describe('sourceHost & isArchiveUrl', () => {
  test('extracts clean hostnames and strips www.', () => {
    expect(sourceHost('https://www.historyarthistory.gmu.edu/courses/hist100.pdf')).toBe('historyarthistory.gmu.edu');
    expect(sourceHost('https://cs.gmu.edu/media/syllabi/Fall2024/CS_310.pdf')).toBe('cs.gmu.edu');
  });

  test('recognizes Internet Archive URLs and excludes archive.org as a department host', () => {
    const wayback = 'https://web.archive.org/web/20240815000000/https://cehd.gmu.edu/assets/docs/syllabi/2024/syllabus_1.pdf';
    expect(isArchiveUrl(wayback)).toBe(true);
    expect(sourceHost(wayback)).toBe('');
    expect(isArchiveUrl('https://cs.gmu.edu/syllabi/')).toBe(false);
  });

  test('handles empty and malformed URLs safely', () => {
    expect(sourceHost('')).toBe('');
    expect(sourceHost(null)).toBe('');
    expect(sourceHost('not a url')).toBe('');
    expect(isArchiveUrl('not a url')).toBe(false);
  });
});

describe('monthYearLabel', () => {
  test('formats ISO timestamps as Mon YYYY in UTC', () => {
    expect(monthYearLabel('2026-03-01T00:00:00Z')).toBe('Mar 2026');
    expect(monthYearLabel('2026-11-15T18:30:00.123456+00:00')).toBe('Nov 2026');
  });

  test('returns empty string for missing or invalid dates', () => {
    expect(monthYearLabel(null)).toBe('');
    expect(monthYearLabel('')).toBe('');
    expect(monthYearLabel('invalid')).toBe('');
  });
});

describe('provenanceLabel', () => {
  test('formats student uploads with approval date when present', () => {
    expect(
      provenanceLabel({
        termLabel: 'Fall 2025',
        source: 'upload',
        approvedAt: '2026-03-14T12:00:00Z',
      })
    ).toBe('Fall 2025 · Student upload · approved Mar 2026');

    expect(
      provenanceLabel(
        {
          source: 'upload',
          createdAt: '2026-03-14T12:00:00Z',
        },
        { includeTerm: false }
      )
    ).toBe('Student upload · approved Mar 2026');

    expect(provenanceLabel({ source: 'upload' })).toBe('Student upload');
  });

  test('formats CHSS and Mason Korea sources using sourceUrl hostname when available', () => {
    expect(
      provenanceLabel({
        termLabel: 'Fall 2025',
        source: 'gmu-chss',
        sourceUrl: 'https://historyarthistory.gmu.edu/media/syllabi/hist100.pdf',
      })
    ).toBe('Fall 2025 · from historyarthistory.gmu.edu');

    expect(
      provenanceLabel({
        termLabel: 'Spring 2025',
        source: 'gmu-chss',
      })
    ).toBe('Spring 2025 · from chss.gmu.edu');

    expect(
      provenanceLabel({
        termLabel: 'Fall 2025',
        source: 'gmu-masonkorea',
        source_url: 'https://masonkorea.gmu.edu/files/syllabus.pdf',
      })
    ).toBe('Fall 2025 · from masonkorea.gmu.edu');

    expect(
      provenanceLabel({
        termLabel: 'Fall 2025',
        source: 'gmu-chss',
        sourceUrl: 'https://d101vc9winf8ln.cloudfront.net/syllabuses/12345/original/syllabus.pdf',
      })
    ).toBe('Fall 2025 · from chss.gmu.edu');

    expect(
      provenanceLabel({
        termLabel: 'Fall 2025',
        source: 'gmu-masonkorea',
        sourceUrl: 'https://d101vc9winf8ln.cloudfront.net/syllabuses/67890/original/syllabus.pdf',
      })
    ).toBe('Fall 2025 · from masonkorea.gmu.edu');
  });

  test('formats linked-only offerings as "linked from <host>"', () => {
    const hist = {
      termLabel: 'Fall 2025',
      source: 'gmu-chss',
      sourceUrl: 'https://historyarthistory.gmu.edu/media/syllabi/hist100.pdf',
      linked: true,
    };
    expect(provenanceOf(hist).isLinked).toBe(true);
    expect(provenanceLabel(hist)).toBe('Fall 2025 · linked from historyarthistory.gmu.edu');

    expect(
      provenanceLabel({
        termLabel: 'Fall 2025',
        source: 'gmu-chss',
        sourceUrl: 'https://d101vc9winf8ln.cloudfront.net/syllabuses/12345/original/syllabus.pdf',
        linked: true,
      })
    ).toBe('Fall 2025 · linked from chss.gmu.edu');

    expect(
      provenanceLabel({
        termLabel: 'Spring 2026',
        source: 'gmu-masonkorea',
        sourceUrl: 'https://d101vc9winf8ln.cloudfront.net/syllabuses/67890/original/syllabus.pdf',
        linked: true,
      })
    ).toBe('Spring 2026 · linked from masonkorea.gmu.edu');

    expect(
      provenanceLabel({
        termLabel: 'Fall 2025',
        source: 'gmu-other',
        sourceUrl: 'https://historyarthistory.gmu.edu/syllabi/hist100.pdf',
        linked: true,
      })
    ).toBe('Fall 2025 · linked from historyarthistory.gmu.edu');

    expect(provenanceOf({ termLabel: 'Fall 2025', source: 'gmu-chss' }).isLinked).toBe(false);
  });

  test('formats CS, CEHD, Math, Science/COS, and Internet Archive sources', () => {
    expect(provenanceLabel({ termLabel: 'Spring 2025', source: 'gmu-cs' })).toBe(
      'Spring 2025 · from cs.gmu.edu (Internet Archive)'
    );
    expect(provenanceLabel({ termLabel: 'Spring 2024', source: 'gmu-cehd' })).toBe(
      'Spring 2024 · from cehd.gmu.edu (Internet Archive)'
    );
    expect(provenanceLabel({ termLabel: 'Spring 2022', source: 'gmu-math' })).toBe(
      'Spring 2022 · from math.gmu.edu'
    );
    expect(
      provenanceLabel({
        termLabel: 'Fall 2021',
        source: 'gmu-math',
        sourceUrl: 'https://science.gmu.edu/media/math113.pdf',
      })
    ).toBe('Fall 2021 · from science.gmu.edu');
    expect(provenanceLabel({ termLabel: 'Fall 2024', source: 'gmu-cos' })).toBe(
      'Fall 2024 · from science.gmu.edu'
    );
    expect(provenanceLabel({ termLabel: 'Fall 2024', source: 'gmu-science' })).toBe(
      'Fall 2024 · from science.gmu.edu'
    );
    expect(provenanceLabel({ source: 'archive' })).toBe('Internet Archive copy');
    expect(
      provenanceLabel({
        sourceUrl: 'https://web.archive.org/web/20240101/https://example.edu/s.pdf',
      })
    ).toBe('Internet Archive copy');
  });

  test('handles filename-inferred sources and flags them', () => {
    const csFile = provenanceOf({ termLabel: 'Fall 2023', source: 'gmu-cs-filename' });
    expect(csFile.isFilenameInferred).toBe(true);
    expect(csFile.isArchive).toBe(true);
    expect(provenanceLabel({ termLabel: 'Fall 2023', source: 'gmu-cs-filename' })).toBe(
      'Fall 2023 · from cs.gmu.edu (Internet Archive)'
    );

    const mathFile = provenanceOf({ termLabel: 'Spring 2020', source: 'gmu-math-filename' });
    expect(mathFile.isFilenameInferred).toBe(true);
    expect(provenanceLabel({ termLabel: 'Spring 2020', source: 'gmu-math-filename' })).toBe(
      'Spring 2020 · from math.gmu.edu'
    );
  });

  test('falls back to sourceUrl hostname for unknown sources and stays empty when nothing is known', () => {
    expect(
      provenanceLabel({
        termLabel: 'Fall 2025',
        source: 'gmu-other',
        sourceUrl: 'https://business.gmu.edu/syllabi/acct203.pdf',
      })
    ).toBe('Fall 2025 · from business.gmu.edu');

    expect(provenanceLabel({})).toBe('');
    expect(provenanceLabel(null)).toBe('');
  });
});
