import { describe, expect, test } from 'vitest';
import { scrapeRunMessage, updatedLabel } from './status';

describe('updatedLabel', () => {
  test('shows the date the way the footer says it', () => {
    expect(updatedLabel('2026-11-01T12:00:00.000Z')).toBe('Nov 1, 2026');
    // The scraper writes Python's isoformat, with microseconds and +00:00.
    expect(updatedLabel('2026-11-02T12:40:00.123456+00:00')).toBe('Nov 2, 2026');
  });

  test('is empty when there is no time to show', () => {
    expect(updatedLabel(null)).toBe('');
    expect(updatedLabel(undefined)).toBe('');
    expect(updatedLabel('not a date')).toBe('');
  });
});

describe('scrapeRunMessage', () => {
  const startedAt = '2026-11-05T19:00:00Z';
  test('says nothing without a run', () => {
    expect(scrapeRunMessage(null)).toBe('');
  });
  test('describes a running scrape', () => {
    expect(scrapeRunMessage({ running: true, status: 'queued', startedAt })).toBe('Running since Nov 5, 2026');
  });
  test('describes a finished or failed one', () => {
    expect(scrapeRunMessage({ status: 'completed', conclusion: 'success', startedAt })).toBe('Last run Nov 5, 2026 finished');
    expect(scrapeRunMessage({ status: 'completed', conclusion: 'failure', startedAt, event: 'schedule' })).toBe(
      'Last run Nov 5, 2026 failed (weekly run)'
    );
    expect(scrapeRunMessage({ status: 'completed', conclusion: 'skipped' })).toBe('Last run ended (skipped)');
  });
});
