import { describe, expect, test } from 'vitest';
import { formToSummary, hasRollup, hasSummary, summaryCredit, summaryToForm } from './summary';

const SUMMARY = {
  overview: 'Data structures in Java.',
  prerequisites: 'CS 211.',
  topics: ['Lists', 'Trees'],
  tools: ['Java'],
  textbooks: [],
  workload: ['5 projects'],
  grading: [
    { item: 'Projects', weight: '40%' },
    { item: 'Participation', weight: '' },
  ],
  policies: { lateWork: 'Two late days.', attendance: '', aiUse: 'Not allowed.' },
};

describe('hasSummary', () => {
  test('is false for missing or empty summaries', () => {
    expect(hasSummary(null)).toBe(false);
    expect(hasSummary({ overview: '', topics: [], policies: {} })).toBe(false);
    expect(hasSummary({ policies: { aiUse: 'Ask first.' } })).toBe(true);
    expect(hasSummary(SUMMARY)).toBe(true);
  });
});

describe('summary form', () => {
  test('round-trips a summary through the admin form', () => {
    const form = summaryToForm(SUMMARY);
    expect(form.topics).toBe('Lists\nTrees');
    expect(form.grading).toBe('Projects: 40%\nParticipation');
    expect(formToSummary(form)).toEqual(SUMMARY);
  });

  test('drops blank lines and splits the weight at the last colon', () => {
    const form = { ...summaryToForm({}), topics: ' Graphs \n\n Heaps', grading: 'Exams: midterm: 30%' };
    const summary = formToSummary(form);
    expect(summary.topics).toEqual(['Graphs', 'Heaps']);
    expect(summary.grading).toEqual([{ item: 'Exams: midterm', weight: '30%' }]);
  });
});

describe('summaryCredit', () => {
  test('says who wrote it', () => {
    expect(summaryCredit({ provider: 'Gemini', generatedAt: '2026-11-02T12:00:00Z' })).toBe('AI summary by Gemini, Nov 2, 2026');
    expect(summaryCredit({ provider: 'Gemini', editedAt: '2026-11-03T12:00:00Z' })).toBe(
      'AI summary, checked by an admin Nov 3, 2026'
    );
  });
});

describe('course rollups', () => {
  test('the credit says how many syllabi the rollup was made from', () => {
    expect(summaryCredit({ provider: 'Gemini', generatedAt: '2026-11-09T12:00:00Z', fileIds: ['a', 'b', 'c'] })).toBe(
      'AI summary of 3 syllabi by Gemini, Nov 9, 2026'
    );
  });

  test('hasRollup is true for an overview or differences alone', () => {
    expect(hasRollup(null)).toBe(false);
    expect(hasRollup({ overview: '', topics: [] })).toBe(false);
    expect(hasRollup({ overview: 'Usually trees.' })).toBe(true);
    expect(hasRollup({ differences: ['One uses Python.'] })).toBe(true);
  });
});
