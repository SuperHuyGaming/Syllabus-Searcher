import { expect, test } from '@playwright/test';
import { FILE_A, mockApi } from './mockApi';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('search inside syllabi from the home page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Search inside syllabi' }).click();

  await page.getByLabel('Search syllabus text').fill('python');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page).toHaveURL(/\/search\?q=python$/);
  await expect(page.getByText('1 syllabi mention python')).toBeVisible();
  await expect(page.locator('mark')).toHaveText('Python');
  await expect(page.getByRole('link', { name: 'View syllabus' })).toHaveAttribute('href', `/api/syllabi/${FILE_A}`);
});

test('search results link to the course', async ({ page }) => {
  await page.goto('/search?q=python');
  await page.getByRole('link', { name: 'CS 310' }).click();
  await expect(page.getByRole('heading', { name: 'CS 310' })).toBeVisible();
});

test('says when nothing matches', async ({ page }) => {
  await page.goto('/search?q=cobol');
  await expect(page.getByText('No syllabi mention cobol')).toBeVisible();
});
