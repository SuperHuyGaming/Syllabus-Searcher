import { expect, test } from '@playwright/test';
import { mockApi } from './mockApi';

const pdf = { name: 'syllabus.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 test') };
const schoolPicker = (page) => page.getByRole('banner').getByRole('combobox', { name: 'School' });
const box = (page, school) => page.getByLabel(`Subject, course or professor at ${school}`);
const UNC = 'University of North Carolina at Chapel Hill';

test('the home page search picks a school and lists that school', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  // Home picks the school in its search box, so the header has no picker there.
  await expect(schoolPicker(page)).toHaveCount(0);

  await page.getByLabel('Your school').fill('chapel hill');
  await page.getByRole('option', { name: new RegExp(UNC) }).click();

  await expect(page).toHaveURL(/\/\?school=unc$/);
  await expect(page.getByRole('heading', { name: `Find a syllabus at ${UNC}` })).toBeVisible();
  await expect(page.getByText('UNC syllabi come from students')).toBeVisible();
  // UNC has no syllabi yet, so the list starts on its computer science department.
  await expect(page.getByRole('heading', { name: /All Computer Science courses/ })).toContainText('0 of 1 have syllabi');

  await page.getByRole('link', { name: /COMP 110/ }).click();
  await expect(page).toHaveURL(/\/courses\/unc:COMP110$/);
  await expect(page.getByRole('heading', { name: 'UNC COMP 110' })).toBeVisible();
  await expect(page.getByText('No syllabi for COMP 110 yet.')).toBeVisible();

  await page.getByRole('link', { name: 'All COMP courses' }).click();
  await expect(page).toHaveURL(/\/\?school=unc&dept=COMP$/);
});

test("course search only finds the chosen school's courses", async ({ page }) => {
  await mockApi(page);
  await page.goto('/?school=unc');
  await box(page, 'UNC').fill('intro');
  await expect(page.getByRole('option')).toHaveText([/COMP 110.*Introduction to Programming/]);

  // The picked school is remembered, so going back to GMU takes picking it.
  await page.goto('/?school=gmu');
  await box(page, 'GMU').fill('intro');
  await expect(page.getByText('Nothing at GMU matches')).toBeVisible();
});

test('a shared link opens the school and department it names, and the school sticks', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?school=unc&dept=AERO');
  await expect(page.getByRole('heading', { name: /All Aerospace Studies courses/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Find a syllabus at ${UNC}` })).toBeVisible();

  await page.getByRole('banner').getByRole('link', { name: 'Professors' }).click();
  await expect(page.getByText('Every UNC professor with a syllabus on file')).toBeVisible();
  await expect(schoolPicker(page)).toHaveText('UNC');
  await page.reload();
  await expect(schoolPicker(page)).toHaveText('UNC');
});

test("switching departments keeps the school in the address", async ({ page }) => {
  await mockApi(page);
  await page.goto('/?school=unc');
  await box(page, 'UNC').fill('aero');
  await page.getByRole('option', { name: /^Aerospace Studies/ }).click();
  await expect(page).toHaveURL(/\/\?school=unc&dept=AERO$/);
});

test("an upload from another school's course page is sent for that school", async ({ page }) => {
  let sent;
  await mockApi(page, { onUpload: (params) => (sent = params) });
  await page.goto('/courses/unc:COMP110');
  await page.getByRole('main').getByRole('link', { name: 'Upload', exact: true }).click();

  await expect(page).toHaveURL(/\/upload\?course=COMP\+110&school=unc$/);
  await expect(page.getByText(/This one is for University of North Carolina at Chapel Hill/)).toBeVisible();
  const course = page.getByRole('combobox', { name: 'Course code' });
  await expect(course).toHaveValue('COMP 110');
  await expect(course).toHaveAccessibleDescription('COMP 110 · Introduction to Programming');

  await page.getByLabel('Section').fill('001');
  await page.getByLabel('Professor').fill('Smith, J');
  await page.locator('input[type=file]').setInputFiles(pdf);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText(/waiting for review/)).toBeVisible();
  expect(sent.get('course')).toBe('COMP 110');
  expect(sent.get('school')).toBe('unc');
});

test('the school in the heading changes it, and GMU addresses stay as they were', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?school=unc');
  await page.getByRole('button', { name: UNC }).click();
  await expect(page.getByRole('heading', { name: 'Enter your school to find a syllabus' })).toBeVisible();
  await expect(page.getByLabel('Your school')).toBeFocused();
  await page.getByRole('button', { name: `Back to ${UNC}` }).click();
  await expect(page.getByRole('heading', { name: `Find a syllabus at ${UNC}` })).toBeVisible();

  await page.getByRole('button', { name: 'I want a different school' }).click();
  await page.getByLabel('Your school').fill('gmu');
  await page.getByRole('option', { name: /George Mason/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /All Computer Science courses/ })).toContainText('2 of 3 have syllabi');
});

test('the header fits the longest school name without clipping it, and a made-up school falls back to GMU', async ({ page }) => {
  await mockApi(page);
  await page.goto('/professors?school=gatech');
  const picker = schoolPicker(page);
  await expect(picker).toHaveText('Georgia Tech');
  const clipped = await picker.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(false);
  await expect(page.getByRole('link', { name: 'Syllabus Searcher home' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.goto('/professors?school=nope');
  await expect(picker).toHaveText('GMU');
});

test('the home page search fits a phone screen', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/?school=unc');
  await expect(page.getByRole('heading', { name: `Find a syllabus at ${UNC}` })).toBeVisible();
  await box(page, 'UNC').fill('comp');
  await expect(page.getByRole('option', { name: /^Computer Science/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
