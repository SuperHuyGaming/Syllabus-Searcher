import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Course from './Course';
import { SchoolProvider } from '../components/School';
import { api } from '../api';

globalThis.React = React;

vi.mock('../api', () => ({
  api: {
    schools: vi.fn().mockResolvedValue({
      schools: [{ key: 'gmu', name: 'George Mason University', short: 'GMU', city: 'Fairfax, VA' }],
    }),
    course: vi.fn(),
  },
  syllabusUrl: (id) => `/api/syllabi/${id}`,
}));

function renderCourse(code = 'CS399') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/courses/${code}`]}>
        <SchoolProvider>
          <Routes>
            <Route path="/courses/:code" element={<Course />} />
          </Routes>
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

describe('Course page special-topics and online hints', () => {
  test('displays special-topics offering label only when topic is non-empty', async () => {
    api.course.mockResolvedValue({
      code: 'CS399',
      display: 'CS 399',
      title: 'Special Topics in Computer Science',
      school: 'gmu',
      dept: 'CS',
      hasOnlineHint: false,
      offerings: [
        {
          id: 'TERM#2026-3#SEC#001#a',
          termKey: '2026-3',
          termLabel: 'Fall 2026',
          section: '001',
          instructors: ['Ada Lovelace'],
          topic: 'AI, Technology & Society',
          fileId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
          contentType: 'application/pdf',
          source: 'gmu-cs',
        },
        {
          id: 'TERM#2025-3#SEC#002#b',
          termKey: '2025-3',
          termLabel: 'Fall 2025',
          section: '002',
          instructors: ['Grace Hopper'],
          fileId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
          contentType: 'application/pdf',
          source: 'gmu-cs',
        },
      ],
    });

    renderCourse('CS399');
    expect(await screen.findByText('CS 399 · Fall 2026 · AI, Technology & Society')).toBeInTheDocument();
    expect(screen.queryByText('CS 399 · Fall 2025')).not.toBeInTheDocument();
  });

  test('shows online hint notice on zero-syllabus course without external links', async () => {
    api.course.mockResolvedValue({
      code: 'MATH113',
      display: 'MATH 113',
      title: 'Analytic Geometry and Calculus I',
      school: 'gmu',
      dept: 'MATH',
      hasOnlineHint: true,
      offerings: [],
    });

    renderCourse('MATH113');
    expect(await screen.findByText('A syllabus for this course was spotted online. Took it? Upload it.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload' })).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    for (const link of links) {
      expect(link.getAttribute('href') || '').not.toMatch(/studocu|coursehero/i);
    }
  });

  test('does not show online hint notice when hasOnlineHint is false', async () => {
    api.course.mockResolvedValue({
      code: 'MATH114',
      display: 'MATH 114',
      title: 'Analytic Geometry and Calculus II',
      school: 'gmu',
      dept: 'MATH',
      hasOnlineHint: false,
      offerings: [],
    });

    renderCourse('MATH114');
    expect(await screen.findByText(/Took this course\? Upload its syllabus/i)).toBeInTheDocument();
    expect(screen.queryByText(/spotted online/i)).not.toBeInTheDocument();
  });
});
