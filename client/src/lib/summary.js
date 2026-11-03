// AI summaries of syllabi (see api/src/lib/ai.js): what the course page shows,
// and the admin form that edits one. Lists are edited one item per line, and the
// grading breakdown as "Projects: 40%" lines.
const LISTS = ['topics', 'tools', 'textbooks', 'workload'];
export const POLICIES = [
  { field: 'lateWork', label: 'Late work' },
  { field: 'attendance', label: 'Attendance' },
  { field: 'aiUse', label: 'AI tools' },
];

// True when there's anything worth showing.
export function hasSummary(summary) {
  if (!summary) return false;
  return Boolean(
    summary.overview ||
      summary.prerequisites ||
      LISTS.some((field) => summary[field]?.length) ||
      summary.grading?.length ||
      POLICIES.some(({ field }) => summary.policies?.[field])
  );
}

// "AI summary by Gemini, Nov 2, 2026" or "Edited by an admin, Nov 3, 2026".
export function summaryCredit(record) {
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '');
  if (record?.editedAt) return `AI summary, checked by an admin ${date(record.editedAt)}`.trim();
  const by = record?.provider ? ` by ${record.provider}` : '';
  return `AI summary${by}${record?.generatedAt ? `, ${date(record.generatedAt)}` : ''}`;
}

export function summaryToForm(summary = {}) {
  const form = {
    overview: summary.overview || '',
    prerequisites: summary.prerequisites || '',
    grading: (summary.grading || []).map((row) => (row.weight ? `${row.item}: ${row.weight}` : row.item)).join('\n'),
  };
  for (const field of LISTS) form[field] = (summary[field] || []).join('\n');
  for (const { field } of POLICIES) form[field] = summary.policies?.[field] || '';
  return form;
}

const lines = (text) =>
  String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function formToSummary(form) {
  const summary = {
    overview: form.overview.trim(),
    prerequisites: form.prerequisites.trim(),
    // The weight is whatever follows the last colon, so "Exams: midterm: 30%" still works.
    grading: lines(form.grading).map((line) => {
      const i = line.lastIndexOf(':');
      return i === -1 ? { item: line, weight: '' } : { item: line.slice(0, i).trim(), weight: line.slice(i + 1).trim() };
    }),
    policies: {},
  };
  for (const field of LISTS) summary[field] = lines(form[field]);
  for (const { field } of POLICIES) summary.policies[field] = form[field].trim();
  return summary;
}
