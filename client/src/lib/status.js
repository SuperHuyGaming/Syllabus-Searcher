// "Nov 1, 2026" for the footer, in the reader's time zone. Empty when there's no time yet
// (a new site before its first scrape) or it can't be read.
export function updatedLabel(iso) {
  const time = iso ? new Date(iso) : null;
  if (!time || Number.isNaN(time.getTime())) return '';
  return time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// One line about the latest Scrape syllabi run on /admin, e.g. "Running since Nov 5, 2026"
// or "Last run Nov 5, 2026 finished". Empty when the site has never been scraped.
export function scrapeRunMessage(run) {
  if (!run) return '';
  const when = updatedLabel(run.startedAt);
  const on = when ? ` ${when}` : '';
  if (run.running) return `Running${when ? ` since ${when}` : ''}`;
  const result = {
    success: 'finished',
    failure: 'failed',
    cancelled: 'was cancelled',
    timed_out: 'timed out',
  }[run.conclusion] || `ended (${run.conclusion || run.status})`;
  return `Last run${on} ${result}${run.event === 'schedule' ? ' (weekly run)' : ''}`;
}
