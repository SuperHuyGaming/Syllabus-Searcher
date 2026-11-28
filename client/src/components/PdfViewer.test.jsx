import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { getDocumentMock } = vi.hoisted(() => ({
  getDocumentMock: vi.fn(),
}));

vi.mock('pdfjs-dist', () => ({
  AnnotationMode: { DISABLE: 0 },
  PDFWorker: vi.fn(),
  getDocument: getDocumentMock,
}));

import PdfViewer from './PdfViewer';

globalThis.React = React;

beforeEach(() => {
  getDocumentMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('PdfViewer linked-file fallback', () => {
  test('renders a link to /api/syllabi/<id> without calling pdf.js when linked is true', () => {
    const fileId = '65f1a2b3c4d5e6f7a8b9c0d1';
    render(<PdfViewer linked fileId={fileId} />);

    expect(getDocumentMock).not.toHaveBeenCalled();
    expect(screen.getByText(/hosted on an external site/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open syllabus/i });
    expect(link).toHaveAttribute('href', `/api/syllabi/${fileId}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('uses explicit href when provided for a linked file', () => {
    const href = 'https://d101vc9winf8ln.cloudfront.net/syllabuses/12345/original/syllabus.pdf';
    render(<PdfViewer linked href={href} />);

    expect(getDocumentMock).not.toHaveBeenCalled();
    const link = screen.getByRole('link', { name: /open syllabus/i });
    expect(link).toHaveAttribute('href', href);
  });

  test('does not render Open syllabus button when linked has neither href nor fileId', () => {
    render(<PdfViewer linked />);

    expect(getDocumentMock).not.toHaveBeenCalled();
    expect(screen.getByText(/hosted on an external site/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open syllabus/i })).not.toBeInTheDocument();
  });
});
