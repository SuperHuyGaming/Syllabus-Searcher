import { describe, expect, test } from 'vitest';
import { updatedLabel } from './status';

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
