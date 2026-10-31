import { expect, test } from '@playwright/test';
import { FILE_A, mockApi } from './mockApi';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('search a course code and open its page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Find a syllabus' })).toBeVisible();

  await page.getByLabel('Course code or name').fill('cs 310');
  await page.getByRole('option', { name: /CS 310/ }).click();

  await expect(page).toHaveURL(/\/courses\/CS310$/);
  await expect(page.getByRole('heading', { name: 'CS 310' })).toBeVisible();
});

test('search matches course titles too', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Course code or name').fill('algorithms');
  await expect(page.getByRole('option')).toHaveText([/CS 483/]);
});

test('course page groups syllabi by term, newest first', async ({ page }) => {
  await page.goto('/courses/CS310');
  const terms = page.getByRole('heading', { level: 2 });
  await expect(terms).toHaveText(['Fall 2024', 'Spring 2023']);
  await expect(page.getByText('Details from file name')).toBeVisible();

  const first = page.getByRole('link', { name: 'View syllabus' }).first();
  await expect(first).toHaveAttribute('href', `/api/syllabi/${FILE_A}`);
  await expect(first).toHaveAttribute('target', '_blank');
});

test('filter a course by professor', async ({ page }) => {
  await page.goto('/courses/CS310');
  await page.getByLabel('Professor').click();
  await page.getByRole('option', { name: 'Masri, W' }).click();

  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Fall 2024']);
  await expect(page.getByRole('link', { name: 'View syllabus' })).toHaveCount(1);
});

test('unknown course offers an upload', async ({ page }) => {
  await page.goto('/courses/CS999');
  await expect(page.getByText('No syllabi found for CS999')).toBeVisible();
  await page.getByRole('link', { name: 'Upload', exact: true }).click();
  await expect(page.getByLabel('Course code')).toHaveValue('CS999');
});

test('professor name on a course links to their page', async ({ page }) => {
  await page.goto('/courses/CS310');
  await page.getByRole('link', { name: 'Russell, K' }).first().click();

  await expect(page).toHaveURL(/\/professors\/russell-k$/);
  await expect(page.getByRole('heading', { name: 'Russell, K' })).toBeVisible();
  await expect(page.getByText('2 syllabi across 2 courses')).toBeVisible();
});

test('search professors by name', async ({ page }) => {
  await page.goto('/professors');
  await page.getByLabel('Search by name').fill('mas');
  await expect(page.getByRole('link', { name: /Masri, W/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Russell, K/ })).toHaveCount(0);
});

test('unknown pages show not found', async ({ page }) => {
  await page.goto('/no/such/page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('no horizontal scrolling', async ({ page }) => {
  for (const path of ['/', '/courses/CS310', '/professors', '/upload']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
