import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { AnnotationMode, PDFWorker, getDocument } from 'pdfjs-dist';
import { pageText } from '../lib/pdftext';

// pdf.js parses in a worker. Vite bundles it as a plain .js file, so S3 and nginx
// serve it with a JavaScript type (they don't all know .mjs). One worker serves every
// file and is handed to each getDocument call: a loading task only shuts down a worker
// it made itself, so closing the viewer can't break the next file opened right after.
const worker = new PDFWorker({
  port: new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' }),
});

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

// Draws an uploaded PDF onto a canvas with pdf.js, so the admin never hands the file
// to the OS or a desktop reader. pdf.js doesn't run a PDF's JavaScript, and links,
// form fields and other annotations are left out, so the page is only a picture.
// `data` is the file as an ArrayBuffer. Loaded lazily, since pdf.js is large.
export default function PdfViewer({ data }) {
  const canvasRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [zoom, setZoom] = useState(3);
  const [showText, setShowText] = useState(true);
  const [text, setText] = useState('');

  // The dialog mounts a new viewer for each file, so state starts fresh per file.
  useEffect(() => {
    // pdf.js moves the bytes to its worker, so pass a copy and keep `data` usable.
    let closed = false;
    const task = getDocument({ data: new Uint8Array(data.slice(0)), worker });
    task.promise.then(
      (doc) => !closed && setPdf(doc),
      (err) => !closed && setError(err.message)
    );
    return () => {
      closed = true;
      task.destroy();
    };
  }, [data]);

  useEffect(() => {
    if (!pdf) return undefined;
    let cancelled = false;
    let render;
    (async () => {
      const page = await pdf.getPage(pageNum);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: ZOOMS[zoom] });
      const ratio = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      render = page.render({
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        annotationMode: AnnotationMode.DISABLE,
      });
      const content = await page.getTextContent();
      if (!cancelled) setText(pageText(content.items));
      await render.promise;
    })().catch((err) => {
      if (!cancelled && err?.name !== 'RenderingCancelledException') setError(err.message);
    });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [pdf, pageNum, zoom]);

  if (error) return <Alert severity="error">Could not show this PDF: {error}</Alert>;

  const pages = pdf?.numPages ?? 0;
  return (
    <Stack spacing={1} sx={{ height: '100%' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Button size="small" onClick={() => setPageNum((n) => n - 1)} disabled={pageNum <= 1}>
          Previous
        </Button>
        <Typography variant="body2" aria-live="polite">
          {pdf ? `Page ${pageNum} of ${pages}` : 'Loading…'}
        </Typography>
        <Button size="small" onClick={() => setPageNum((n) => n + 1)} disabled={pageNum >= pages}>
          Next
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" onClick={() => setZoom((z) => z - 1)} disabled={zoom === 0} aria-label="Zoom out">
          −
        </Button>
        <Typography variant="body2">{Math.round(ZOOMS[zoom] * 100)}%</Typography>
        <Button size="small" onClick={() => setZoom((z) => z + 1)} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in">
          +
        </Button>
        <FormControlLabel
          control={<Switch size="small" checked={showText} onChange={(e) => setShowText(e.target.checked)} />}
          label="Text"
        />
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ flex: 1, minHeight: 0 }}>
        <Box sx={{ flex: 2, overflow: 'auto', bgcolor: 'grey.200', p: 1, minHeight: 300 }}>
          <canvas ref={canvasRef} aria-label={`Page ${pageNum} of the uploaded PDF`} style={{ display: 'block', margin: '0 auto', background: '#fff' }} />
        </Box>
        {showText && (
          <Box sx={{ flex: 1, overflow: 'auto', border: 1, borderColor: 'divider', p: 1, minHeight: 200 }}>
            <Typography component="pre" variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0 }}>
              {text || (pdf ? 'No text found on this page (it may be a scanned image).' : '')}
            </Typography>
          </Box>
        )}
      </Stack>
    </Stack>
  );
}
