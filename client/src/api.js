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

// GMU is the API's default, so it's left out of addresses (and CloudFront caches one copy).
const withSchool = (params, school) => new URLSearchParams({ ...(school && school !== 'gmu' && { school }), ...params });

export const api = {
  schools: () => json('/schools'),
  departments: (school) => json(`/departments?${withSchool({}, school)}`),
  // `dept` is the full key ("CS", "unc:COMP"), so it names its own school.
  courses: (dept = 'CS') => json(`/courses?${new URLSearchParams({ dept })}`),
  // One school's courses whose code or title matches, e.g. "math 2" or "data struct".
  findCourses: (q, school) => json(`/courses?${withSchool({ q }, school)}`),
  course: (code) => json(`/courses/${encodeURIComponent(code)}`),
  professors: (school) => json(`/professors?${withSchool({}, school)}`),
  status: () => json('/status'),
  search: (q, school) => json(`/search?${withSchool({ q }, school)}`),

  upload: ({ course, term, section, instructor, file, school }) => {
    const query = withSchool({ course, term, section, instructor }, school);
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
  adminProfessors: (token, school) => json(`/admin/professors?${withSchool({}, school)}`, { token }),
  // Without `apply` this is a preview: it lists what would change and writes nothing.
  scrapeStatus: (token) => json('/admin/refresh', { token }),
  startScrape: (token) => post('/admin/refresh', {}, token),
  mergeProfessors: ({ from, into, apply, school }, token) =>
    post('/admin/professors/merge', { from, into, apply, school: school || 'gmu' }, token),
};
