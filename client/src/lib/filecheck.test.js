import { describe, expect, test } from 'vitest';
import { fileCheckMessage } from './filecheck';

describe('fileCheckMessage', () => {
  test('older uploads without a check show nothing', () => {
    expect(fileCheckMessage(undefined)).toBeNull();
  });

  test('clean, stripped and HTML uploads', () => {
    expect(fileCheckMessage({ status: 'clean', pages: 1, removed: [] })).toEqual({
      severity: 'success',
      text: 'File check: clean. Stored a rebuilt copy (1 page).',
    });
    expect(fileCheckMessage({ status: 'stripped', pages: 4, removed: ['JavaScript', 'embedded file'] })).toEqual({
      severity: 'warning',
      text: 'Removed from the PDF: JavaScript, embedded file. Stored a rebuilt copy (4 pages).',
    });
    expect(fileCheckMessage({ status: 'html' }).severity).toBe('info');
  });
});
