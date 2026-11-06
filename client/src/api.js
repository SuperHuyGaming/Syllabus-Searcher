async function request(path, { token, ...options } = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return res;
}

const json = (path, options) => request(path, options).then((res) => res.json());
const post = (path, body, token) =>
  json(path, { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

export const syllabusUrl = (fileId) => `/api/syllabi/${fileId}`;

export const api = {
  courses: () => json('/courses?dept=CS'),
  course: (code) => json(`/courses/${encodeURIComponent(code)}`),
  professors: () => json('/professors'),
  status: () => json('/status'),
  search: (q) => json(`/search?${new URLSearchParams({ q })}`),

  upload: ({ course, term, section, instructor, file }) => {
    const query = new URLSearchParams({ course, term, section, instructor });
    const type = /\.html?$/i.test(file.name) ? 'text/html' : 'application/pdf';
    return json(`/uploads?${query}`, { method: 'POST', headers: { 'Content-Type': type }, body: file });
  },

  pendingUploads: (token) => json('/admin/uploads', { token }),
  pendingFile: (id, token) => request(`/admin/uploads/${id}/file`, { token }).then((res) => res.blob()),
  // `details` may correct course, term, section and instructor before publishing.
  approve: (id, details, token) => post(`/admin/uploads/${id}/approve`, details, token),
  reject: (id, note, token) => post(`/admin/uploads/${id}/reject`, { note }, token),
  aiCheck: (id, details, token) => post(`/admin/uploads/${id}/ai-check`, details, token),
  adminCourse: (code, token) => json(`/admin/courses/${encodeURIComponent(code)}`, { token }),
  updateOffering: (changes, token) => post('/admin/offerings/update', changes, token),
  deleteOffering: ({ code, id }, token) => post('/admin/offerings/delete', { code, id }, token),
  saveSummary: (fileId, summary, token) => post(`/admin/summaries/${fileId}`, { summary }, token),
  regenerateSummary: (fileId, token) => post(`/admin/summaries/${fileId}/regenerate`, {}, token),
  adminProfessors: (token) => json('/admin/professors', { token }),
  // Without `apply` this is a preview: it lists what would change and writes nothing.
  scrapeStatus: (token) => json('/admin/refresh', { token }),
  startScrape: (token) => post('/admin/refresh', {}, token),
  mergeProfessors: ({ from, into, apply }, token) => post('/admin/professors/merge', { from, into, apply }, token),
};
