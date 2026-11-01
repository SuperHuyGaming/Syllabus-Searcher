const { PDFDocument, PDFName, PDFString } = require('pdf-lib');
const { sanitizePdf, PdfRejected } = require('../src/lib/pdfcheck');

async function makePdf({ pages = 1, risky = false, encrypted = false } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage().drawText(`CS 310 syllabus page ${i + 1}`);

  if (risky) {
    const ctx = doc.context;
    const script = ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("hi")') });
    doc.catalog.set(PDFName.of('OpenAction'), ctx.register(script));
    doc.catalog.set(
      PDFName.of('Names'),
      ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('x'), ctx.register(script)] }) })
    );

    const page = doc.getPage(0).node;
    page.set(PDFName.of('AA'), ctx.obj({ O: ctx.register(script) }));
    const rect = [0, 0, 50, 50];
    const webLink = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, A: { S: 'URI', URI: PDFString.of('https://gmu.edu') } });
    const launch = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, A: { S: 'Launch', F: PDFString.of('calc.exe') } });
    const attachment = ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: rect });
    page.set(PDFName.of('Annots'), ctx.obj([ctx.register(webLink), ctx.register(launch), ctx.register(attachment)]));
  }

  if (encrypted) doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard' }));
  return Buffer.from(await doc.save());
}

describe('sanitizePdf', () => {
  test('rebuilds a clean PDF and reports it clean', async () => {
    const { buffer, check } = await sanitizePdf(await makePdf({ pages: 3 }));
    expect(check).toEqual({ status: 'clean', pages: 3, removed: [] });
    expect((await PDFDocument.load(buffer)).getPageCount()).toBe(3);
  });

  test('strips scripts, auto-run actions, launch links and attachments', async () => {
    const { buffer, check } = await sanitizePdf(await makePdf({ risky: true }));
    expect(check.status).toBe('stripped');
    expect(check.removed).toEqual(['JavaScript', 'auto-run action', 'embedded file', 'launch action']);

    // The stored copy has none of it left. The web link still works; the launch
    // link stays as a link that does nothing.
    expect((await sanitizePdf(buffer)).check).toEqual({ status: 'clean', pages: 1, removed: [] });
    const rebuilt = await PDFDocument.load(buffer);
    const annots = rebuilt.getPage(0).node.Annots();
    expect(annots.size()).toBe(2);
    const uri = rebuilt.context.lookup(annots.get(0)).lookup(PDFName.of('A')).get(PDFName.of('URI'));
    expect(uri.decodeText()).toBe('https://gmu.edu');
  });

  test('rejects encrypted, oversized, empty and unreadable files', async () => {
    await expect(sanitizePdf(await makePdf({ encrypted: true }))).rejects.toThrow(/password-protected/);
    await expect(sanitizePdf(await makePdf({ pages: 3 }), { maxPages: 2 })).rejects.toThrow(/under 2 pages/);
    await expect(sanitizePdf(Buffer.from('%PDF-1.7\nnot really'))).rejects.toThrow(PdfRejected);
  });
});
