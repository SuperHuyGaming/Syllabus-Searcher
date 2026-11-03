// What the admin card says about an upload's AI check (see api/src/lib/ai.js).
// Returns null for uploads made before the check, or
// { severity, title, reasons, matches, footer } for an MUI Alert.
const TITLES = {
  legit: { severity: 'success', title: 'AI check: likely a real syllabus' },
  review: { severity: 'warning', title: 'AI check: needs a closer look' },
  junk: { severity: 'error', title: 'AI check: likely junk' },
};
const FIELDS = ['course', 'term', 'section', 'instructor'];

export function aiCheckMessage(ai) {
  if (!ai) return null;
  const checked = ai.checkedAt ? `checked ${new Date(ai.checkedAt).toLocaleString()}` : '';
  if (ai.unavailable || !TITLES[ai.verdict]) {
    return {
      severity: 'info',
      title: 'AI check unavailable',
      reasons: [ai.unavailable || 'The answer could not be read.', 'Review the file by hand, or run the check again later.'],
      matches: [],
      footer: checked,
    };
  }

  const footer = [
    ai.provider && `${ai.provider} ${ai.model || ''}`.trim(),
    checked,
    ai.redacted > 0 && `${ai.redacted} email${ai.redacted === 1 ? '' : 's'}, phone numbers or IDs hidden before sending`,
    ai.truncated && 'only the first 20,000 characters were read',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    ...TITLES[ai.verdict],
    reasons: [ai.documentType && `Looks like: ${ai.documentType}.`, ...(ai.reasons || [])].filter(Boolean),
    // Chips for each detail the student entered: matches, doesn't match, or not stated.
    matches: ai.matches
      ? FIELDS.map((field) => ({ field, value: ['yes', 'no'].includes(ai.matches[field]) ? ai.matches[field] : 'unclear' }))
      : [],
    footer,
  };
}
