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

async function mockAdminApi(page, onFile, { html = false, ai, onAiCheck, virusScan, courseCode = 'CS310' } = {}) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/uploads') {
      const upload = {
        id: UPLOAD_ID,
        course_code: courseCode,
        term_key: '2026-3',
        section: '001',
        instructor: 'Russell, K',
        file_size: 2048,
        created_at: '2026-11-01T18:00:00Z',
        detected: {
          fileCheck: html ? { status: 'html' } : { status: 'stripped', pages: 2, removed: ['JavaScript'] },
          virusScan,
          ai: ai?.(),
        },
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uploads: [upload] }) });
    }
    if (path === `/api/admin/uploads/${UPLOAD_ID}/ai-check` && onAiCheck) {
      onAiCheck(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
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

test('a pending PDF can also open in a new tab', async ({ page }) => {
  // Test browsers have no PDF reader (a PDF tab just stays blank), so window.open
  // returns a stand-in tab that records where it was sent.
  await page.addInitScript(() => {
    window.openedTab = { opener: window, location: { href: '' }, openedBeforeFetch: false, close() {} };
    window.open = () => {
      window.openedTab.openedBeforeFetch = !window.fileFetched;
      return window.openedTab;
    };
  });
  await signIn(page);
  await mockAdminApi(page, () => page.evaluate(() => (window.fileFetched = true)).catch(() => {}));
  await page.goto('/admin');

  await page.getByRole('button', { name: 'Open in new tab' }).click();
  await expect.poll(() => page.evaluate(() => window.openedTab.location.href)).toMatch(/^blob:/);
  const tab = await page.evaluate(async () => {
    const res = await fetch(window.openedTab.location.href);
    const text = await res.text();
    return { type: res.headers.get('content-type'), start: text.slice(0, 5), opener: window.openedTab.opener, early: window.openedTab.openedBeforeFetch };
  });
  expect(tab).toEqual({ type: 'application/pdf', start: '%PDF-', opener: null, early: true });
  await expect(page.getByRole('alert').filter({ hasText: /blocked|Only PDFs/ })).toHaveCount(0);
});

test('HTML uploads have no new-tab button, since they would run on this site', async ({ page }) => {
  await signIn(page);
  await mockAdminApi(page, undefined, { html: true });
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'View file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open in new tab' })).toHaveCount(0);
});

test('the AI verdict shows on the card and can be run again with corrected details', async ({ page }) => {
  let ai = {
    verdict: 'review',
    documentType: 'course syllabus',
    reasons: ["Doesn't match the entered section."],
    matches: { course: 'yes', term: 'yes', section: 'no', instructor: 'unclear' },
    provider: 'Gemini',
    model: 'gemini-3.5-flash-lite',
    checkedAt: '2026-11-02T15:00:00Z',
  };
  let sent;
  await signIn(page);
  await mockAdminApi(page, null, {
    ai: () => ai,
    onAiCheck: (body) => {
      sent = body;
      ai = { ...ai, verdict: 'legit', reasons: ['A CS 310 syllabus for section 002.'], matches: { ...ai.matches, section: 'yes' } };
    },
  });

  await page.goto('/admin');
  await expect(page.getByText('AI check: needs a closer look')).toBeVisible();
  await expect(page.getByText("Doesn't match the entered section.")).toBeVisible();
  await expect(page.getByText('section ✗')).toBeVisible();
  await expect(page.getByText(/Gemini gemini-3.5-flash-lite/)).toBeVisible();

  await page.getByLabel('Section').fill('002');
  await page.getByRole('button', { name: 'Run again' }).click();
  await expect(page.getByText('AI check: likely a real syllabus')).toBeVisible();
  await expect(page.getByText('section ✓')).toBeVisible();
  expect(sent).toMatchObject({ course: 'CS 310', section: '002' });
});

test('an upload without an AI check offers to run one', async ({ page }) => {
  await signIn(page);
  await mockAdminApi(page);
  await page.goto('/admin');
  await expect(page.getByText('No AI check yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run AI check' })).toBeVisible();
});

test('an upload the virus scan flagged cannot be approved', async ({ page }) => {
  await signIn(page);
  await mockAdminApi(page, null, { virusScan: { status: 'infected', signature: 'Eicar-Test-Signature' } });
  await page.goto('/admin');
  await expect(page.getByText('Virus scan found Eicar-Test-Signature')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reject' })).toBeEnabled();
});

test('admin edits and regenerates a syllabus summary', async ({ page }) => {
  const FILE = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  let record = {
    summary: { overview: 'Old overview.', topics: ['Trees'], tools: [], textbooks: [], workload: [], grading: [], policies: {} },
    provider: 'Gemini',
    generatedAt: '2026-11-02T12:00:00Z',
  };
  const saved = [];
  await signIn(page);
  await mockAdminApi(page);
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/courses?dept=CS', (route) =>
    route.fulfill(json({ dept: 'CS', courses: [{ code: 'CS310', display: 'CS 310', title: 'Data Structures', hasSyllabi: true }] }))
  );
  await page.route('**/api/admin/courses/CS310', (route) =>
    route.fulfill(
      json({
        code: 'CS310',
        display: 'CS 310',
        title: 'Data Structures',
        offerings: [
          { id: 'TERM#2024-3#SEC#001', termKey: '2024-3', termLabel: 'Fall 2024', section: '001', instructors: ['Russell, K'], fileId: FILE, source: 'gmu-cs', summary: record },
        ],
      })
    )
  );
  await page.route(`**/api/admin/summaries/${FILE}**`, (route) => {
    if (route.request().url().endsWith('/regenerate')) {
      record = { ...record, summary: { ...record.summary, overview: 'Fresh from the AI.' } };
    } else {
      saved.push(route.request().postDataJSON().summary);
      record = { ...record, summary: saved.at(-1), editedAt: '2026-11-03T12:00:00Z' };
    }
    return route.fulfill(json(record));
  });

  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Published syllabi' }).click();
  await page.getByLabel('Course code').fill('CS 310');
  await page.getByRole('button', { name: 'Summary' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Overview')).toHaveValue('Old overview.');
  await dialog.getByRole('button', { name: 'Regenerate' }).click();
  await expect(dialog.getByLabel('Overview')).toHaveValue('Fresh from the AI.');

  await dialog.getByLabel('Topics (one per line)').fill('Trees\nGraphs');
  await dialog.getByLabel(/^Grading/).fill('Projects: 40%');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved[0]).toMatchObject({
    overview: 'Fresh from the AI.',
    topics: ['Trees', 'Graphs'],
    grading: [{ item: 'Projects', weight: '40%' }],
  });
});

test('admin merges two spellings of a professor after a preview', async ({ page }) => {
  let names = [
    { name: 'Gonzalez Hernandez, A', count: 2, courses: ['CS 580'] },
    { name: 'González, Ana', count: 1, courses: ['CS 584'] },
    { name: 'Yu, Craig', count: 3, courses: ['CS 351'] },
  ];
  const sent = [];
  await signIn(page);
  await mockAdminApi(page);
  await page.route('**/api/admin/professors**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/professors') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ professors: names }) });
    }
    const body = route.request().postDataJSON();
    sent.push(body);
    const changes = [
      { code: 'CS580', term: 'Fall 2024', section: '001', before: ['Gonzalez Hernandez, A'], after: ['González, Ana'] },
      { code: 'CS580', term: 'Spring 2025', section: '002', before: ['Gonzalez Hernandez, A'], after: ['González, Ana'] },
    ];
    if (body.apply) names = names.filter((n) => n.name !== body.from);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ applied: Boolean(body.apply), changes }) });
  });

  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Professors' }).click();
  await page.getByRole('button', { name: 'Gonzalez Hernandez, A → González, Ana' }).click();
  await expect(page.getByLabel('Replace this spelling')).toHaveValue('Gonzalez Hernandez, A');
  await expect(page.getByLabel('With this name')).toHaveValue('González, Ana');

  await page.getByRole('button', { name: 'Preview merge' }).click();
  await expect(page.getByText('2 syllabi will change:')).toBeVisible();
  await expect(page.getByText('CS 580 Spring 2025, section 002: Gonzalez Hernandez, A → González, Ana')).toBeVisible();
  expect(sent).toEqual([{ from: 'Gonzalez Hernandez, A', into: 'González, Ana', school: 'gmu' }]);

  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.getByText('Merged "Gonzalez Hernandez, A" into "González, Ana" on 2 syllabi.')).toBeVisible();
  expect(sent[1]).toEqual({ from: 'Gonzalez Hernandez, A', into: 'González, Ana', apply: true, school: 'gmu' });
  await expect(page.getByRole('button', { name: /→ González, Ana/ })).toHaveCount(0);
});

test('admin starts a scrape from Site data and sees it running', async ({ page }) => {
  let run = { status: 'completed', conclusion: 'success', running: false, event: 'schedule', startedAt: '2026-11-02T09:00:00Z', url: 'https://github.com/o/r/actions/runs/1' };
  let started = 0;
  await signIn(page);
  await mockAdminApi(page);
  await page.route('**/api/admin/refresh', (route) => {
    if (route.request().method() === 'POST') {
      started += 1;
      run = { status: 'queued', conclusion: null, running: true, event: 'workflow_dispatch', startedAt: '2026-11-05T19:00:00Z', url: 'https://github.com/o/r/actions/runs/2' };
      return route.fulfill({ status: 202, contentType: 'application/json', body: '{"started":true}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, environment: 'staging', run }) });
  });

  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Site data' }).click();
  await expect(page.getByText('Runs the Scrape syllabi workflow for the staging site')).toBeVisible();
  await expect(page.getByText(/Last run Nov \d, 2026 finished \(weekly run\)/)).toBeVisible();

  await page.getByRole('button', { name: 'Refresh now' }).click();
  await expect(page.getByText(/Running since Nov \d, 2026/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/o/r/actions/runs/2');
  expect(started).toBe(1);
});

test('Site data says how to set up refresh when the token is missing', async ({ page }) => {
  await signIn(page);
  await mockAdminApi(page);
  await page.route('**/api/admin/refresh', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false,"environment":null,"run":null}' })
  );
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Site data' }).click();
  await expect(page.getByText(/Not set up on this site: add the GH_DISPATCH_TOKEN secret/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeDisabled();
});

test("an upload for another school shows its school, and the course field reads codes there", async ({ page }) => {
  await signIn(page);
  await mockAdminApi(page, null, { courseCode: 'unc:COMP110' });
  await page.goto('/admin');
  await expect(page.getByText(/Student entered: UNC COMP 110/)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Course code' })).toHaveValue('COMP 110');
});
