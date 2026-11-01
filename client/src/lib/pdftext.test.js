import { describe, expect, test } from 'vitest';
import { pageText } from './pdftext';

describe('pageText', () => {
  test('joins text runs and breaks lines where pdf.js marks them', () => {
    const items = [
      { str: 'CS 310', hasEOL: false },
      { str: ' Data Structures', hasEOL: true },
      { str: 'Fall 2026  ', hasEOL: true },
      { str: 'Section 001', hasEOL: false },
    ];
    expect(pageText(items)).toBe('CS 310 Data Structures\nFall 2026\nSection 001');
  });

  test('collapses runs of blank lines and handles empty pages', () => {
    const items = [{ str: 'A', hasEOL: true }, { str: '', hasEOL: true }, { str: '', hasEOL: true }, { str: '', hasEOL: true }, { str: 'B' }];
    expect(pageText(items)).toBe('A\n\nB');
    expect(pageText([])).toBe('');
  });

  test('skips marked-content items that have no text', () => {
    expect(pageText([{ type: 'beginMarkedContent' }, { str: 'Hi', hasEOL: false }])).toBe('Hi');
  });
});
