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
  await page.getByRole('main').getByRole('link', { name: 'Upload', exact: true }).click();
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
  await page.getByRole('combobox', { name: 'Search by first or last name' }).fill('mas');
  await expect(page.getByRole('link', { name: /Masri, W/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Russell, K/ })).toHaveCount(0);
});

test('find a professor by first name and open them from the suggestions', async ({ page }) => {
  await page.goto('/professors');
  const search = page.getByRole('combobox', { name: 'Search by first or last name' });
  await search.fill('david');
  const option = page.getByRole('option', { name: /Gonzalez Samudio, David/ });
  await expect(option).toContainText('CS 211');
  await option.hover();
  await option.click();
  await expect(page).toHaveURL(/\/professors\/gonzalez-samudio-david$/);
  await expect(page.getByRole('heading', { name: 'Gonzalez Samudio, David' })).toBeVisible();
});

test('search by second surname and pick with the keyboard', async ({ page }) => {
  await page.goto('/professors');
  const search = page.getByRole('combobox', { name: 'Search by first or last name' });
  await search.fill('samudio');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/professors\/gonzalez-samudio-david$/);
});

test('a catalog course with no syllabi shows its details and asks for one', async ({ page }) => {
  await page.goto('/courses/CS105');
  await expect(page.getByRole('heading', { name: 'CS 105' })).toBeVisible();
  await expect(page.getByText('1 credit', { exact: true })).toBeVisible();
  await expect(page.getByText(/legal, social, and ethical issues/)).toBeVisible();
  await expect(page.getByText('No syllabi for CS 105 yet.')).toBeVisible();
  await expect(page.getByLabel('Term')).toHaveCount(0);
  await page.getByRole('link', { name: 'Upload' }).last().click();
  await expect(page).toHaveURL(/\/upload\?course=CS105$/);
});

test('course page shows credits and prerequisites', async ({ page }) => {
  await page.goto('/courses/CS310');
  await expect(page.getByText('3 credits')).toBeVisible();
  await expect(page.getByText('CS 211 (C) and MATH 113 (C)')).toBeVisible();
});

test('home lists every course and can hide ones without syllabi', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('2 of 3 have syllabi')).toBeVisible();
  await expect(page.getByRole('link', { name: /CS 105/ })).toContainText('No syllabi yet');
  await page.getByLabel('Only with syllabi').check();
  await expect(page.getByRole('link', { name: /CS 105/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /CS 310/ })).toBeVisible();
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
