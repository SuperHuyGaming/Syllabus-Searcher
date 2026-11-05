import { describe, expect, test } from 'vitest';
import { fileCheckMessage, virusScanMessage } from './filecheck';

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

describe('virusScanMessage', () => {
  test('is null for uploads made before the scan', () => {
    expect(virusScanMessage(undefined)).toBeNull();
  });
  test('shows each result with a fitting severity', () => {
    expect(virusScanMessage({ status: 'clean', scannedAt: '2026-11-04T12:00:00Z' }).severity).toBe('success');
    expect(virusScanMessage({ status: 'infected', signature: 'Eicar-Test-Signature' })).toEqual({
      severity: 'error',
      text: "Virus scan found Eicar-Test-Signature. Reject this upload; it can't be approved.",
    });
    expect(virusScanMessage({ status: 'error', error: 'timeout' }).severity).toBe('warning');
    expect(virusScanMessage({ status: 'not-scanned' }).text).toMatch(/Run workflow/);
  });
});
