// What the admin card says about the upload's file check (see api/src/lib/pdfcheck.js).
// Returns { severity, text } for an MUI Alert, or null for uploads made before the check.
export function fileCheckMessage(check) {
  if (!check) return null;
  if (check.status === 'html') {
    return { severity: 'info', text: 'HTML page: not rebuilt, but shown with scripts off.' };
  }
  const pages = `${check.pages} page${check.pages === 1 ? '' : 's'}`;
  if (check.status === 'stripped') {
    return { severity: 'warning', text: `Removed from the PDF: ${check.removed.join(', ')}. Stored a rebuilt copy (${pages}).` };
  }
  return { severity: 'success', text: `File check: clean. Stored a rebuilt copy (${pages}).` };
}
