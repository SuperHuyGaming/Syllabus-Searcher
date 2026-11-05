// "Nov 1, 2026" for the footer, in the reader's time zone. Empty when there's no time yet
// (a new site before its first scrape) or it can't be read.
export function updatedLabel(iso) {
  const time = iso ? new Date(iso) : null;
  if (!time || Number.isNaN(time.getTime())) return '';
  return time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
