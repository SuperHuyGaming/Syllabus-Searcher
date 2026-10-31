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

  upload: ({ course, term, section, instructor, file }) => {
    const query = new URLSearchParams({ course, term, section, instructor });
    return json(`/uploads?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
  },

  pendingUploads: (token) => json('/admin/uploads', { token }),
  pendingFile: (id, token) => request(`/admin/uploads/${id}/file`, { token }).then((res) => res.blob()),
  approve: (id, title, token) => post(`/admin/uploads/${id}/approve`, { title }, token),
  reject: (id, note, token) => post(`/admin/uploads/${id}/reject`, { note }, token),
};
