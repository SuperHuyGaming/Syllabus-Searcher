import { describe, expect, test } from 'vitest';
import { aiCheckMessage } from './aicheck';

describe('aiCheckMessage', () => {
  test('older uploads without a check show nothing', () => {
    expect(aiCheckMessage(undefined)).toBeNull();
  });

  test('a verdict with reasons, match chips and where it came from', () => {
    const message = aiCheckMessage({
      verdict: 'review',
      documentType: 'course syllabus',
      reasons: ["Doesn't match the entered section."],
      matches: { course: 'yes', term: 'yes', section: 'no', instructor: 'maybe' },
      provider: 'Gemini',
      model: 'gemini-3.5-flash-lite',
      redacted: 2,
      truncated: true,
    });
    expect(message.severity).toBe('warning');
    expect(message.title).toBe('AI check: needs a closer look');
    expect(message.reasons).toEqual(['Looks like: course syllabus.', "Doesn't match the entered section."]);
    expect(message.matches).toEqual([
      { field: 'course', value: 'yes' },
      { field: 'term', value: 'yes' },
      { field: 'section', value: 'no' },
      { field: 'instructor', value: 'unclear' },
    ]);
    expect(message.footer).toBe(
      'Gemini gemini-3.5-flash-lite · 2 emails, phone numbers or IDs hidden before sending · only the first 20,000 characters were read'
    );
  });

  test('legit and junk verdicts', () => {
    expect(aiCheckMessage({ verdict: 'legit', reasons: [] }).severity).toBe('success');
    expect(aiCheckMessage({ verdict: 'junk', reasons: ['Homework.'] })).toMatchObject({ severity: 'error', title: 'AI check: likely junk' });
  });

  test('an unavailable check tells the admin to review by hand', () => {
    const message = aiCheckMessage({ unavailable: 'Gemini free quota used up.' });
    expect(message).toMatchObject({ severity: 'info', title: 'AI check unavailable' });
    expect(message.reasons[0]).toBe('Gemini free quota used up.');
  });
});
