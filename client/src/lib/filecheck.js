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

// What the admin card says about the upload's virus scan (see api/src/lib/virusscan.js).
// Returns { severity, text } for an MUI Alert, or null for uploads made before the scan.
export function virusScanMessage(scan) {
  if (!scan) return null;
  const when = scan.scannedAt ? ` on ${new Date(scan.scannedAt).toLocaleDateString()}` : '';
  if (scan.status === 'clean') return { severity: 'success', text: `Virus scan: clean (ClamAV${when}).` };
  if (scan.status === 'infected') {
    return { severity: 'error', text: `Virus scan found ${scan.signature}. Reject this upload; it can't be approved.` };
  }
  if (scan.status === 'error') {
    return { severity: 'warning', text: `Virus scan failed (${scan.error}). The next scheduled scan tries again.` };
  }
  return {
    severity: 'info',
    text: 'Not virus-scanned yet. The scan runs every two hours, or now from Actions → Virus scan → Run workflow.',
  };
}
