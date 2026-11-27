import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import HomeSearch from './HomeSearch';
import { SchoolProvider } from './School';

globalThis.React = React;

vi.mock('../api', () => ({
  api: {
    schools: vi.fn().mockResolvedValue({
      schools: [{ key: 'gmu', name: 'George Mason University', short: 'GMU', city: 'Fairfax, VA' }],
    }),
    findCourses: vi.fn().mockResolvedValue({ courses: [] }),
    professors: vi.fn().mockResolvedValue({ professors: [] }),
  },
}));

const departments = [
  { code: 'CS', display: 'CS', name: 'Computer Science', courses: 3, withSyllabi: 2 },
  { code: 'MATH', display: 'MATH', name: 'Mathematics', courses: 1, withSyllabi: 0 },
];

function renderSearch(extra = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/?school=gmu']}>
        <SchoolProvider>
          <HomeSearch departments={departments} onSubject={vi.fn()} />
          {extra}
        </SchoolProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('HomeSearch "/" keyboard shortcut', () => {
  test('focuses the search box from anywhere on the page without typing "/"', () => {
    renderSearch(<button type="button">Other</button>);
    const input = screen.getByLabelText('Subject, course or professor at GMU');
    const other = screen.getByRole('button', { name: 'Other' });
    other.focus();
    expect(document.activeElement).toBe(other);

    fireEvent.keyDown(other, { key: '/' });
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue('');
  });

  test('does not hijack "/" when a text input, textarea or contentEditable is focused', () => {
    renderSearch(
      <>
        <input aria-label="Text field" type="text" />
        <textarea aria-label="Notes" />
        <div aria-label="Rich editor" contentEditable tabIndex={0} suppressContentEditableWarning />
      </>
    );
    const search = screen.getByLabelText('Subject, course or professor at GMU');

    for (const label of ['Text field', 'Notes', 'Rich editor']) {
      const el = screen.getByLabelText(label);
      el.focus();
      expect(document.activeElement).toBe(el);
      const notCancelled = fireEvent.keyDown(el, { key: '/' });
      expect(notCancelled).toBe(true);
      expect(document.activeElement).toBe(el);
      expect(document.activeElement).not.toBe(search);
    }
  });

  test('focuses the search box when a checkbox (like a filter switch) is focused', () => {
    renderSearch(<input aria-label="Only with syllabi" type="checkbox" />);
    const search = screen.getByLabelText('Subject, course or professor at GMU');
    const checkbox = screen.getByLabelText('Only with syllabi');
    checkbox.focus();

    fireEvent.keyDown(checkbox, { key: '/' });
    expect(document.activeElement).toBe(search);
  });

  test('ignores "/" when modifier keys are held', () => {
    renderSearch(<button type="button">Other</button>);
    const search = screen.getByLabelText('Subject, course or professor at GMU');
    const other = screen.getByRole('button', { name: 'Other' });
    other.focus();

    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      fireEvent.keyDown(other, { key: '/', ...mod });
      expect(document.activeElement).toBe(other);
      expect(document.activeElement).not.toBe(search);
    }
  });
});
