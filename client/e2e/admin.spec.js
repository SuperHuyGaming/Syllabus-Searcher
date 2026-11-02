import { expect, test } from '@playwright/test';

const UPLOAD_ID = '60ef8221-a69e-4a5f-82d0-41fb1b3b5ec0';

// A small two-page PDF written by hand, one line of text per page.
function makePdf(lines) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const line of lines) {
    const stream = `BT /F1 18 Tf 72 720 Td (${line}) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.7\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// Signs in as an admin by putting a session where the Supabase client keeps it.
async function signIn(page) {
  await page.addInitScript(() => {
    const session = {
      access_token: 'e2e-token',
      refresh_token: 'e2e-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'e2e', email: 'admin@gmu.edu', aud: 'authenticated', role: 'authenticated' },
    };
    localStorage.setItem('sb-e2e-auth-token', JSON.stringify(session));
  });
  await page.route('https://e2e.supabase.co/**', (route) => route.fulfill({ status: 200, body: '{}' }));
}

async function mockAdminApi(page, onFile) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/uploads') {
      const upload = {
        id: UPLOAD_ID,
        course_code: 'CS310',
        term_key: '2026-3',
        section: '001',
        instructor: 'Russell, K',
        file_size: 2048,
        created_at: '2026-11-01T18:00:00Z',
        detected: { fileCheck: { status: 'stripped', pages: 2, removed: ['JavaScript'] } },
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uploads: [upload] }) });
    }
    if (path === `/api/admin/uploads/${UPLOAD_ID}/file`) {
      onFile?.(route.request());
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: makePdf(['CS 310 Syllabus', 'Grading policy']) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Not found"}' });
  });
}

test('admin views a pending PDF on the page', async ({ page }) => {
  let fileAuth;
  await signIn(page);
  await mockAdminApi(page, (request) => (fileAuth = request.headers().authorization));

  await page.goto('/admin');
  await expect(page.getByText('Removed from the PDF: JavaScript')).toBeVisible();

  const popups = [];
  page.on('popup', (popup) => popups.push(popup));
  await page.getByRole('button', { name: 'View file' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Page 1 of 2')).toBeVisible();
  await expect(dialog.getByText('CS 310 Syllabus')).toBeVisible();
  expect(fileAuth).toBe('Bearer e2e-token');

  // Something was drawn on the canvas (not just the blank white page).
  const canvas = dialog.locator('canvas');
  await expect
    .poll(() =>
      canvas.evaluate((el) => {
        const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
        for (let i = 0; i < data.length; i += 4) if (data[i] < 128) return true;
        return false;
      })
    )
    .toBe(true);

  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Page 2 of 2')).toBeVisible();
  await expect(dialog.getByText('Grading policy')).toBeVisible();

  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  await expect(dialog.getByText('150%')).toBeVisible();

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  expect(popups).toHaveLength(0);
});

// Clicking "View file" several times, or closing and reopening right away, used to reuse
// pdf.js's worker while it was shutting down; the error took the whole page down.
test('clicking the viewer open and shut quickly keeps the page working', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await signIn(page);
  await mockAdminApi(page);
  await page.goto('/admin');

  const view = page.getByRole('button', { name: 'View file' });
  const dialog = page.getByRole('dialog');
  for (let i = 0; i < 3; i += 1) {
    await view.click({ clickCount: 4 });
    await dialog.getByRole('button', { name: 'Close' }).click();
  }
  await view.click();
  await expect(dialog.getByText('Page 1 of 2')).toBeVisible();
  await expect(dialog.getByText('CS 310 Syllabus')).toBeVisible();
  expect(errors).toEqual([]);
});
