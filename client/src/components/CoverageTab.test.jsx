import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import CoverageTab from './CoverageTab';
import { SchoolProvider } from './School';
import { api } from '../api';

globalThis.React = React;

vi.mock('../api', () => ({
  api: {
    schools: vi.fn().mockResolvedValue({
      schools: [{ key: 'gmu', name: 'George Mason University', short: 'GMU', city: 'Fairfax, VA' }],
    }),
    adminCoverage: vi.fn(),
  },
}));

function renderCoverage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin?school=gmu']}>
        <SchoolProvider>
          <CoverageTab token="admin-token" />
        </SchoolProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  api.schools.mockResolvedValue({
    schools: [{ key: 'gmu', name: 'George Mason University', short: 'GMU', city: 'Fairfax, VA' }],
  });
});

afterEach(() => {
  cleanup();
});

describe('CoverageTab', () => {
  test('shows an empty state when no coverage report exists yet', async () => {
    api.adminCoverage.mockResolvedValue({ school: 'gmu', coverage: null, hints: [] });
    renderCoverage();
    expect(await screen.findByText(/No coverage report has been computed/i)).toBeInTheDocument();
  });

  test('sorts departments by most missing, shows totals and expands to reveal missing courses and hints', async () => {
    api.adminCoverage.mockResolvedValue({
      school: 'gmu',
      coverage: {
        school: 'gmu',
        computedAt: '2026-11-28T15:00:00Z',
        totals: { courses: 120, withSyllabi: 45, withoutSyllabi: 75 },
        departments: [
          { dept: 'CS', courses: 40, withSyllabi: 30, withoutSyllabi: 10, missingCourses: ['CS 499'] },
          { dept: 'MATH', courses: 80, withSyllabi: 15, withoutSyllabi: 65, missingCourses: ['MATH 113', 'MATH 114'] },
        ],
      },
      hints: [
        {
          code: 'MATH 113',
          school: 'gmu',
          url: 'https://www.studocu.com/en-us/document/gmu/math-113',
          title: 'MATH 113 Calculus I Syllabus',
          snippet: 'Weekly schedule and grading breakdown',
          host: 'studocu.com',
          foundAt: '2026-11-27T12:00:00Z',
        },
      ],
    });

    renderCoverage();
    expect(await screen.findByText('120 total')).toBeInTheDocument();
    expect(screen.getByText('45 with syllabi')).toBeInTheDocument();
    expect(screen.getByText('75 missing')).toBeInTheDocument();
    expect(screen.getByText(/Last computed:/i)).toBeInTheDocument();

    const cards = screen.getAllByTestId(/^coverage-dept-/);
    expect(cards.map((el) => el.getAttribute('data-testid'))).toEqual(['coverage-dept-MATH', 'coverage-dept-CS']);

    const mathCard = cards[0];
    fireEvent.click(within(mathCard).getByRole('button', { name: /Show missing/i }));
    expect(within(mathCard).getByText('MATH 113 · hint')).toBeInTheDocument();
    expect(within(mathCard).getByText('MATH 114')).toBeInTheDocument();
    expect(within(mathCard).getByText('studocu.com')).toBeInTheDocument();
    expect(within(mathCard).getByText('MATH 113 Calculus I Syllabus')).toBeInTheDocument();
    expect(within(mathCard).getByText('Weekly schedule and grading breakdown')).toBeInTheDocument();
  });
});
