const { json, binary, header, bodyJson, HttpError } = require('../lib/http');
const { parseTerm, displayCourse, normalizeCourse } = require('../lib/terms');
const { parseDetails, parseCourse, parseTermInput, parseSection, parseInstructors } = require('../lib/details');

const UUID = '([0-9a-f-]{36})';
const NO_STORE = { 'Cache-Control': 'no-store' };

module.exports = ({ catalog, files, uploads, search }) => {
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

  // A new course needs a title; an existing one keeps its stored title unless one is given.
  async function courseTitle(code, title) {
    const meta = await catalog.getCourseMeta(code);
    const courseTitle = String(title || meta?.title || '').trim();
    if (!courseTitle) throw new HttpError(400, `Add a course title for ${displayCourse(code)}`);
    if (courseTitle.length > 120) throw new HttpError(400, 'Course title is too long');
    return courseTitle;
  }

  async function offering(code, id) {
    const found = typeof id === 'string' && (await catalog.getOffering(parseCourse(code), id));
    if (!found) throw new HttpError(404, 'Syllabus not found');
    return found;
  }

  // Keeps full-text search in step with the catalog. Search is a convenience,
  // so a failure here is logged rather than undoing the admin's change.
  async function refreshSearch(fileId) {
    try {
      await search?.refresh(fileId, await catalog.offeringsForFile(fileId));
    } catch (err) {
      console.error('search refresh failed', err);
    }
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
        const body = bodyJson(event);

        // The admin can correct what the student typed before publishing.
        const details = parseDetails({
          course: body.course ?? upload.course_code,
          term: body.term ?? upload.term_key,
          section: body.section ?? upload.section,
          instructor: body.instructor ?? upload.instructor,
        });
        const title = await courseTitle(details.code, body.title);

        await files.move('pending', 'syllabi', upload.file_id);
        await catalog.putOffering({
          dept: details.code.match(/^[A-Z]+/)[0],
          code: details.code,
          title,
          term: details.term,
          section: details.section,
          instructors: [details.instructor],
          fileId: upload.file_id,
          contentType: 'application/pdf',
          source: 'upload',
        });
        const changes = {
          course_code: details.code,
          term_key: details.term.key,
          section: details.section,
          instructor: details.instructor,
        };
        const corrected = Object.keys(changes).some((key) => changes[key] !== upload[key]);
        const reviewed = await uploads.review(upload.id, {
          status: 'approved',
          reviewer,
          ...(corrected && { changes }),
        });
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
    {
      // Published syllabi for one course, uncached so edits show up right away.
      method: 'GET',
      path: /^\/api\/admin\/courses\/([^/]+)$/,
      async handler({ event, params }) {
        await requireAdmin(event);
        const code = normalizeCourse(decodeURIComponent(params[0]));
        if (!code) throw new HttpError(400, 'Course code should look like "CS 310"');
        const course = await catalog.getCourse(code);
        if (!course) throw new HttpError(404, `No syllabi found for ${displayCourse(code)}`);
        return json(200, course, NO_STORE);
      },
    },
    {
      // Fixes a published syllabus: move it to another course, or change its term, section or professors.
      method: 'POST',
      path: /^\/api\/admin\/offerings\/update$/,
      async handler({ event }) {
        const reviewer = await requireAdmin(event);
        const body = bodyJson(event);
        const old = await offering(body.code, body.id);
        const code = parseCourse(body.course ?? old.code);
        const next = {
          dept: code.match(/^[A-Z]+/)[0],
          code,
          title: await courseTitle(code, code === old.code ? body.title || old.title : body.title),
          term: body.term === undefined ? parseTerm(old.termKey) : parseTermInput(body.term),
          section: body.section === undefined ? old.section : parseSection(body.section),
          instructors: body.instructors === undefined ? old.instructors : parseInstructors(body.instructors),
        };
        const updated = await catalog.updateOffering(old, next);
        if (code === old.code && next.title !== old.title) await catalog.putCourse(next);
        await catalog.markCurated(old.sourceUrl, { action: 'edited', by: reviewer });
        await refreshSearch(old.fileId);
        return json(200, { code: updated.code, id: updated.SK }, NO_STORE);
      },
    },
    {
      // Takes a syllabus off the site. The file is deleted once no course points at it.
      method: 'POST',
      path: /^\/api\/admin\/offerings\/delete$/,
      async handler({ event }) {
        const reviewer = await requireAdmin(event);
        const body = bodyJson(event);
        const old = await offering(body.code, body.id);
        await catalog.markCurated(old.sourceUrl, { action: 'deleted', by: reviewer });
        await catalog.deleteOffering(old);
        const remaining = await catalog.offeringsForFile(old.fileId);
        if (remaining.length === 0) await files.remove('syllabi', old.fileId);
        await refreshSearch(old.fileId);
        return json(200, { deleted: true, fileDeleted: remaining.length === 0 }, NO_STORE);
      },
    },
  ];
};
