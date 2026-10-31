const { json, binary, header, bodyJson, HttpError } = require('../lib/http');
const { parseTerm, displayCourse } = require('../lib/terms');

const UUID = '([0-9a-f-]{36})';
const NO_STORE = { 'Cache-Control': 'no-store' };

module.exports = ({ catalog, files, uploads }) => {
  async function requireAdmin(event) {
    const token = (header(event, 'authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, 'Sign in first');
    const email = await uploads.adminEmail(token);
    if (!email) throw new HttpError(403, 'This account is not an admin');
    return email;
  }

  async function pendingUpload(id) {
    const upload = await uploads.get(id);
    if (!upload) throw new HttpError(404, 'Upload not found');
    if (upload.status !== 'pending') throw new HttpError(409, `Upload was already ${upload.status}`);
    return upload;
  }

  return [
    {
      method: 'GET',
      path: /^\/api\/admin\/uploads$/,
      async handler({ event }) {
        await requireAdmin(event);
        return json(200, { uploads: await uploads.listPending() }, NO_STORE);
      },
    },
    {
      method: 'GET',
      path: new RegExp(`^/api/admin/uploads/${UUID}/file$`),
      async handler({ event, params }) {
        await requireAdmin(event);
        const upload = await uploads.get(params[0]);
        const file = upload && (await files.read('pending', upload.file_id));
        if (!file) throw new HttpError(404, 'File not found');
        return binary(file.buffer, file.contentType, NO_STORE);
      },
    },
    {
      method: 'POST',
      path: new RegExp(`^/api/admin/uploads/${UUID}/approve$`),
      async handler({ event, params }) {
        const reviewer = await requireAdmin(event);
        const upload = await pendingUpload(params[0]);
        const { title } = bodyJson(event);

        // New courses need a title; existing ones keep the one already stored.
        const meta = await catalog.getCourseMeta(upload.course_code);
        const courseTitle = (title || meta?.title || '').trim();
        if (!courseTitle) throw new HttpError(400, `Add a course title for ${displayCourse(upload.course_code)}`);

        await files.move('pending', 'syllabi', upload.file_id);
        await catalog.putOffering({
          dept: upload.course_code.match(/^[A-Z]+/)[0],
          code: upload.course_code,
          title: courseTitle,
          term: parseTerm(upload.term_key),
          section: upload.section,
          instructors: [upload.instructor],
          fileId: upload.file_id,
          contentType: 'application/pdf',
          source: 'upload',
        });
        const reviewed = await uploads.review(upload.id, { status: 'approved', reviewer });
        return json(200, reviewed, NO_STORE);
      },
    },
    {
      method: 'POST',
      path: new RegExp(`^/api/admin/uploads/${UUID}/reject$`),
      async handler({ event, params }) {
        const reviewer = await requireAdmin(event);
        const upload = await pendingUpload(params[0]);
        const { note } = bodyJson(event);
        await files.remove('pending', upload.file_id);
        const reviewed = await uploads.review(upload.id, { status: 'rejected', reviewer, note });
        return json(200, reviewed, NO_STORE);
      },
    },
  ];
};
