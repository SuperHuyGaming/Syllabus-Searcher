import { expect, test } from '@playwright/test';
import { mockApi } from './mockApi';

const pdf = { name: 'syllabus.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 test') };

test('upload a syllabus for review', async ({ page }) => {
  let sent;
  await mockApi(page, { onUpload: (params, request) => (sent = { params, type: request.headers()['content-type'] }) });

  await page.goto('/upload');
  await page.getByLabel('Course code').fill('CS 310');
  await page.getByLabel('Section').fill('001');
  await page.getByLabel('Professor').fill('Russell, K');
  await page.locator('input[type=file]').setInputFiles(pdf);
  await page.getByRole('button', { name: 'Submit for review' }).click();

  await expect(page.getByText(/waiting for review/)).toBeVisible();
  expect(sent.params.get('course')).toBe('CS 310');
  expect(sent.params.get('instructor')).toBe('Russell, K');
  expect(sent.type).toBe('application/pdf');
});

test('rejects files that are not PDFs', async ({ page }) => {
  await mockApi(page);
  await page.goto('/upload');
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(page.getByText('Choose a PDF file.')).toBeVisible();
});
