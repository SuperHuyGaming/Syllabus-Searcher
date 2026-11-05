const { json, binary, header, bodyJson, HttpError } = require('../lib/http');
const { parseTerm, displayCourse, normalizeCourse } = require('../lib/terms');
const { parseReviewDetails, parseCourse, parseTermInput, parseSection, parseInstructors } = require('../lib/details');
const { checkUpload: aiCheck } = require('../lib/ai');
const { fileText } = require('../lib/text');
const { aiReview } = require('../lib/review');
const { renameProfessor } = require('../lib/rename');
const { summarize: aiSummarize, cleanSummary } = require('../lib/ai');
const { summarizeFile } = require('../lib/summary');

const UUID = '([0-9a-f-]{36})';
const FILE_ID = '([a-f0-9]{24})';
// Lambda stops after 20 seconds, so the summary made while approving gets a short
// wait; if it runs out, the admin can press "Regenerate" or the weekly job fills it in.
const APPROVE_SUMMARY_MS = 7000;
const NO_STORE = { 'Cache-Control': 'no-store' };
// Uploaded HTML is untrusted: if it's ever opened directly, its scripts can't run.
const HTML_SANDBOX = { 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" };

module.exports = ({
  catalog,
  files,
  uploads,
  search,
  checkUpload = aiCheck,
  readText = fileText,
  summarize = aiSummarize,
}) => {
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

  // A missing summary never blocks the admin, so errors are logged and reported, not thrown.
  async function trySummary(fileId, timeoutMs) {
    try {
      return await summarizeFile({ catalog, files, fileId, readText, summarize, timeoutMs });
    } catch (err) {
      console.error('summary failed', err);
      return { unavailable: 'The summary could not be saved.' };
    }
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
        // The admin page draws the file itself, so it is never meant to run as a page:
        // any file type gets the sandbox, and it's shown inline rather than saved.
        return binary(file.buffer, file.contentType, {
          ...NO_STORE,
          ...HTML_SANDBOX,
          'Content-Disposition': `inline; filename="${(file.filename || 'upload').replace(/"/g, '')}"`,
          'X-Content-Type-Options': 'nosniff',
        });
      },
    },
    {
      // Runs the AI check again, e.g. after the free quota ran out at upload time.
      // It checks the details as currently typed on the card, if any are sent.
      method: 'POST',
      path: new RegExp(`^/api/admin/uploads/${UUID}/ai-check$`),
      async handler({ event, params }) {
        await requireAdmin(event);
        const upload = await pendingUpload(params[0]);
        const body = bodyJson(event);
        const details = parseReviewDetails({
          course: body.course ?? upload.course_code,
          term: body.term ?? upload.term_key,
          section: body.section ?? upload.section,
          instructor: body.instructor ?? upload.instructor,
        });
        const file = await files.read('pending', upload.file_id);
        if (!file) throw new HttpError(404, 'The uploaded file is missing');
        const ai = await aiReview({ catalog, buffer: file.buffer, contentType: file.contentType, details, readText, checkUpload });
        const saved = await uploads.saveDetected(upload.id, { ...upload.detected, ai });
        return json(200, saved || { ...upload, detected: { ...upload.detected, ai } }, NO_STORE);
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
        const details = parseReviewDetails({
          course: body.course ?? upload.course_code,
          term: body.term ?? upload.term_key,
          section: body.section ?? upload.section,
          instructor: body.instructor ?? upload.instructor,
        });
        const title = await courseTitle(details.code, body.title);

        const moved = await files.move('pending', 'syllabi', upload.file_id);
        if (!moved) throw new HttpError(404, 'The uploaded file is missing');
        await catalog.putOffering({
          dept: details.code.match(/^[A-Z]+/)[0],
          code: details.code,
          title,
          term: details.term,
          section: details.section,
          instructors: details.instructors,
          fileId: upload.file_id,
          contentType: moved.contentType,
          source: 'upload',
        });
        await catalog.markUploaded();
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
        const summary = await trySummary(upload.file_id, APPROVE_SUMMARY_MS);
        return json(200, { ...reviewed, summary: summary.unavailable ? { unavailable: summary.unavailable } : 'saved' }, NO_STORE);
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
      // Every professor name as it's stored, one entry per spelling, so the admin can
      // spot two spellings of one person. The public list groups some of these together.
      method: 'GET',
      path: /^\/api\/admin\/professors$/,
      async handler({ event }) {
        await requireAdmin(event);
        const byName = new Map();
        for (const o of await catalog.listOfferings()) {
          for (const name of o.instructors || []) {
            if (!byName.has(name)) byName.set(name, { name, count: 0, courses: new Set() });
            const entry = byName.get(name);
            entry.count += 1;
            entry.courses.add(o.display || displayCourse(o.code));
          }
        }
        const professors = [...byName.values()]
          .map((p) => ({ ...p, courses: [...p.courses].sort() }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return json(200, { professors }, NO_STORE);
      },
    },
    {
      // Merges one spelling of a professor into another on every syllabus that lists it.
      // Without "apply" it only lists what would change, so the admin can check first.
      method: 'POST',
      path: /^\/api\/admin\/professors\/merge$/,
      async handler({ event }) {
        const reviewer = await requireAdmin(event);
        const { from, into, apply } = bodyJson(event);
        let changes;
        try {
          changes = await renameProfessor({ catalog, search }, from, into, { apply: apply === true, by: reviewer });
        } catch (err) {
          if (err instanceof HttpError) throw err;
          throw new HttpError(400, err.message);
        }
        if (changes.length === 0) throw new HttpError(404, `No syllabi list "${String(from).trim()}"`);
        return json(200, { applied: apply === true, changes }, NO_STORE);
      },
    },
    {
      // Saves an admin's corrections to a summary. Kept until someone presses "Regenerate".
      method: 'POST',
      path: new RegExp(`^/api/admin/summaries/${FILE_ID}$`),
      async handler({ event, params }) {
        const reviewer = await requireAdmin(event);
        const fileId = params[0];
        if ((await catalog.offeringsForFile(fileId)).length === 0) throw new HttpError(404, 'Syllabus not found');
        const summary = cleanSummary(bodyJson(event).summary);
        if (!summary.overview && summary.topics.length === 0) {
          throw new HttpError(400, 'Add an overview or at least one topic');
        }
        const old = (await catalog.getSummaries([fileId])).get(fileId) || {};
        const record = { ...old, summary, editedBy: reviewer, editedAt: new Date().toISOString() };
        await catalog.putSummary(fileId, record);
        return json(200, record, NO_STORE);
      },
    },
    {
      // Asks the AI for a fresh summary, replacing any edits.
      method: 'POST',
      path: new RegExp(`^/api/admin/summaries/${FILE_ID}/regenerate$`),
      async handler({ event, params }) {
        await requireAdmin(event);
        const fileId = params[0];
        if ((await catalog.offeringsForFile(fileId)).length === 0) throw new HttpError(404, 'Syllabus not found');
        const record = await trySummary(fileId, 15000);
        if (record.unavailable) throw new HttpError(503, `AI summary unavailable: ${record.unavailable}`);
        return json(200, record, NO_STORE);
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
        if (remaining.length === 0) {
          await files.remove('syllabi', old.fileId);
          if (old.pdfFileId) await files.remove('syllabi', old.pdfFileId);
          await catalog.deleteSummary(old.fileId);
        }
        await refreshSearch(old.fileId);
        return json(200, { deleted: true, fileDeleted: remaining.length === 0 }, NO_STORE);
      },
    },
  ];
};
