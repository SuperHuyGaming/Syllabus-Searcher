import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Search from './Search';
import { SchoolProvider } from '../components/School';
import { api } from '../api';

globalThis.React = React;

vi.mock('../api', () => ({
  api: {
    schools: vi.fn().mockResolvedValue({
      schools: [{ key: 'gmu', name: 'George Mason University', short: 'GMU', city: 'Fairfax, VA' }],
    }),
    search: vi.fn(),
  },
  syllabusUrl: (id) => `/api/syllabi/${id}`,
}));

function renderSearch(query = 'AI') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/search?q=${encodeURIComponent(query)}`]}>
        <SchoolProvider>
          <Search />
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

describe('Search page special-topics formatting', () => {
  test('includes topic formatted with middle dots when present and omits it when empty', async () => {
    api.search.mockResolvedValue({
      query: 'AI',
      school: 'gmu',
      results: [
        {
          fileId: 'f1',
          codes: ['CS399'],
          title: 'Special Topics in Computer Science',
          topic: 'AI, Technology & Society',
          termLabel: 'Fall 2026',
          section: '001',
          instructors: ['Ada Lovelace'],
          snippet: 'AI, Technology & Society covers ethics and policy.',
        },
        {
          fileId: 'f2',
          codes: ['CS580'],
          title: 'Introduction to Artificial Intelligence',
          termLabel: 'Fall 2025',
          section: '002',
          instructors: ['Grace Hopper'],
          snippet: 'Search, planning, and AI fundamentals.',
        },
      ],
    });

    renderSearch('AI');
    expect(
      await screen.findByText('CS 399 · Fall 2026 · AI, Technology & Society · Section 001 · Ada Lovelace')
    ).toBeInTheDocument();
    expect(screen.getByText('CS 580 · Fall 2025 · Section 002 · Grace Hopper')).toBeInTheDocument();
  });
});
