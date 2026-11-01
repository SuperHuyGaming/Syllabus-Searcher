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

test('rejects files that are not PDFs or web pages', async ({ page }) => {
  await mockApi(page);
  await page.goto('/upload');
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(page.getByText('Choose a PDF or HTML file.')).toBeVisible();
});

test('upload a syllabus posted as a web page', async ({ page }) => {
  let sent;
  await mockApi(page, { onUpload: (params, request) => (sent = request.headers()['content-type']) });
  await page.goto('/upload?course=CS483');
  await page.getByLabel('Section').fill('007');
  await page.getByRole('combobox', { name: 'Professor' }).fill('Russell, Raven');
  await page.locator('input[type=file]').setInputFiles({
    name: '483_syllabus_fall_26.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<!DOCTYPE html><html><title>CS483</title></html>'),
  });
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText(/waiting for review/)).toBeVisible();
  expect(sent).toBe('text/html');
});

test('shows the course title so a wrong code is obvious', async ({ page }) => {
  await mockApi(page);
  await page.goto('/upload');
  const course = page.getByRole('combobox', { name: 'Course code' });
  await course.fill('cs 310');
  await expect(course).toHaveAccessibleDescription('CS 310 · Data Structures');
  await course.fill('CS 999');
  await expect(course).toHaveAccessibleDescription("CS 999 isn't on the site yet. Double-check the code.");
});

test('suggests professors already listed for the course', async ({ page }) => {
  await mockApi(page);
  await page.goto('/upload');
  await page.getByLabel('Course code').fill('CS 310');
  await expect(page.getByText('Already listed for CS 310:')).toBeVisible();
  await page.getByRole('button', { name: 'Masri, W' }).click();
  await expect(page.getByRole('combobox', { name: 'Professor' })).toHaveValue('Masri, W');
});
