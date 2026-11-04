import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { api, syllabusUrl } from '../api';
import { supabase } from '../supabase';
import { groupByTerm, recentTerms, termLabel } from '../lib/terms';
import { displayCourse } from '../lib/courses';
import { likelySpellings } from '../lib/professors';
import { fileCheckMessage } from '../lib/filecheck';
import { aiCheckMessage } from '../lib/aicheck';
import { POLICIES, formToSummary, hasSummary, summaryCredit, summaryToForm } from '../lib/summary';
import { CourseField, ProfessorField, useCourseLookup } from '../components/CourseFields';
import ErrorBoundary from '../components/ErrorBoundary';

// Admins may need to fix syllabi older than the upload form's Fall 2022 cutoff.
const ADMIN_TERMS = recentTerms(new Date(), '2015-1');
// pdf.js is large, so it's only downloaded when an admin opens a PDF.
const PdfViewer = lazy(() => import('../components/PdfViewer'));

export default function Admin() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabase) return <Alert severity="warning">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use the admin page.</Alert>;
  if (!session) return <SignIn />;
  return <Dashboard token={session.access_token} email={session.user.email} />;
}

// Email + password signs in right here. The emailed link is a fallback for a forgotten password.
function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signIn = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
  });
  const sendLink = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/admin`, shouldCreateUser: false },
      });
      if (error) throw error;
    },
  });
  const failure = signIn.error || sendLink.error;

  return (
    <Paper
      variant="outlined"
      component="form"
      sx={{ p: 4, maxWidth: 420, mx: 'auto' }}
      onSubmit={(e) => {
        e.preventDefault();
        signIn.mutate();
      }}
    >
      <Typography variant="h5" component="h1" sx={{ mb: 2, fontWeight: 700 }}>
        Admin sign-in
      </Typography>
      <Stack spacing={2}>
        <TextField
          type="email"
          label="Email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <TextField
          type="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {failure && <Alert severity="error">{failure.message}</Alert>}
        {sendLink.isSuccess && <Alert severity="success">Check your email for a sign-in link.</Alert>}
        <Button type="submit" variant="contained" loading={signIn.isPending}>
          Sign in
        </Button>
        <Button
          size="small"
          disabled={!email}
          loading={sendLink.isPending}
          onClick={() => sendLink.mutate()}
        >
          Forgot password? Email me a sign-in link
        </Button>
      </Stack>
    </Paper>
  );
}

function Dashboard({ token, email }) {
  const [tab, setTab] = useState('pending');
  const { data } = useQuery({ queryKey: ['pending'], queryFn: () => api.pendingUploads(token) });
  const count = data?.uploads?.length;

  return (
    <>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, flexGrow: 1 }}>
          Admin
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
          {email}
        </Typography>
        <Button onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </Stack>
      <Tabs value={tab} onChange={(_, next) => setTab(next)} sx={{ mb: 3 }}>
        <Tab value="pending" label={count ? `Pending uploads (${count})` : 'Pending uploads'} />
        <Tab value="published" label="Published syllabi" />
        <Tab value="professors" label="Professors" />
      </Tabs>
      {tab === 'pending' && <ReviewQueue token={token} />}
      {tab === 'published' && <Published token={token} />}
      {tab === 'professors' && <Professors token={token} />}
    </>
  );
}

function ReviewQueue({ token }) {
  const { data, isPending, error } = useQuery({ queryKey: ['pending'], queryFn: () => api.pendingUploads(token) });
  const uploads = data?.uploads || [];

  return (
    <>
      {error && <Alert severity="error">{error.message}</Alert>}
      {!isPending && !error && uploads.length === 0 && <Alert severity="info">Nothing to review.</Alert>}
      <Stack spacing={2}>
        {uploads.map((upload) => (
          <UploadCard key={upload.id} upload={upload} token={token} />
        ))}
      </Stack>
    </>
  );
}

// Lists the term picker's options, keeping an older term the record already has.
function termOptions(current) {
  if (!current || ADMIN_TERMS.some((t) => t.key === current)) return ADMIN_TERMS;
  return [...ADMIN_TERMS, { key: current, label: termLabel(current) }].sort((a, b) => b.key.localeCompare(a.key));
}

// Course, term, section and professor inputs, shared by the review and edit forms.
// A course that isn't on the site yet also needs a title.
function DetailFields({ form, setForm, professorsField = 'instructor' }) {
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const { code, known, loaded } = useCourseLookup(form.course);
  const isNew = Boolean(code && loaded && !known);

  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <CourseField size="small" value={form.course} onChange={set('course')} />
        <TextField
          select
          size="small"
          label="Term"
          value={form.term}
          onChange={(e) => set('term')(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          {termOptions(form.term).map((t) => (
            <MenuItem key={t.key} value={t.key}>
              {t.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField size="small" label="Section" value={form.section} onChange={(e) => set('section')(e.target.value)} />
      </Stack>
      <ProfessorField
        size="small"
        label="Professors"
        course={form.course}
        value={form[professorsField]}
        onChange={set(professorsField)}
        helperText='Separate several professors with ";" (e.g. "Zhu, Z; Yu, F")'
      />
      {isNew && (
        <TextField
          size="small"
          label={`Course title for ${displayCourse(code)}`}
          value={form.title}
          onChange={(e) => set('title')(e.target.value)}
          helperText="This course isn't on the site yet, so it needs a title."
        />
      )}
    </Stack>
  );
}

function UploadCard({ upload, token }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    course: displayCourse(upload.course_code),
    term: upload.term_key,
    section: upload.section,
    instructor: upload.instructor,
    title: '',
  });
  const [note, setNote] = useState('');
  const [htmlPreview, setHtmlPreview] = useState(null);
  const [pdfData, setPdfData] = useState(null);
  const [openError, setOpenError] = useState(null);
  const [opening, setOpening] = useState(false);
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['pending'] });
    queryClient.invalidateQueries({ queryKey: ['course'] });
    queryClient.invalidateQueries({ queryKey: ['courses'] });
  };
  const approve = useMutation({ mutationFn: () => api.approve(upload.id, form, token), onSuccess: done });
  const reject = useMutation({ mutationFn: () => api.reject(upload.id, note, token), onSuccess: done });
  // Checks the details as typed on the card, so a fix can be confirmed before approving.
  const aiCheck = useMutation({
    mutationFn: () => api.aiCheck(upload.id, form, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pending'] }),
  });
  const failure = approve.error || reject.error;

  // The file needs the admin token, so fetch it rather than linking to it. Both kinds
  // are shown on this page: a PDF is drawn by pdf.js (see PdfViewer), and an HTML page,
  // which would run on this site with the admin signed in if opened as a blob, goes in
  // a sandboxed frame (no scripts, no access to this page).
  async function openFile() {
    setOpenError(null);
    setOpening(true);
    try {
      const blob = await api.pendingFile(upload.id, token);
      if (blob.type.startsWith('text/html')) setHtmlPreview(await blob.text());
      else setPdfData(await blob.arrayBuffer());
    } catch (err) {
      setOpenError(err.message);
    } finally {
      setOpening(false);
    }
  }

  // Opens a PDF in the browser's own viewer, for Ctrl+F and printing. Stored PDFs are
  // rebuilt without scripts, so this is safe enough; HTML never opens this way (it
  // would run on this site). The tab is opened during the click, before the download,
  // or the browser's popup blocker would stop it.
  async function openInTab() {
    setOpenError(null);
    const tab = window.open('', '_blank');
    if (!tab) {
      setOpenError('The browser blocked the new tab. Allow pop-ups for this site and try again.');
      return;
    }
    tab.opener = null;
    try {
      const blob = await api.pendingFile(upload.id, token);
      if (!blob.type.startsWith('application/pdf')) throw new Error('Only PDFs open in a new tab. Use View file for web pages.');
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab.close();
      setOpenError(err.message);
    }
  }

  const detected = upload.detected;
  const fileCheck = fileCheckMessage(detected?.fileCheck);
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography sx={{ fontWeight: 700 }}>
          Student entered: {displayCourse(upload.course_code)} · {termLabel(upload.term_key)} · Section {upload.section} ·{' '}
          {upload.instructor}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Uploaded {new Date(upload.created_at).toLocaleString()} · {(upload.file_size / 1024).toFixed(0)} KB
        </Typography>

        {fileCheck && (
          <Alert severity={fileCheck.severity} sx={{ mt: 1 }}>
            {fileCheck.text}
          </Alert>
        )}

        {detected?.courseCodes && (
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2">Azure found:</Typography>
            {[...detected.courseCodes, ...detected.terms].map((value) => (
              <Chip key={value} size="small" label={value} />
            ))}
          </Stack>
        )}

        <AiCheck ai={detected?.ai} running={aiCheck.isPending} error={aiCheck.error} onRun={() => aiCheck.mutate()} />

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          View the file and fix anything that doesn&apos;t match before approving.
        </Typography>
        <DetailFields form={form} setForm={setForm} />
        <TextField
          size="small"
          label="Reject reason (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          fullWidth
          sx={{ mt: 2 }}
        />
        {(failure || openError) && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {failure?.message || openError}
          </Alert>
        )}
      </CardContent>
      <CardActions>
        <Button onClick={openFile} loading={opening}>
          View file
        </Button>
        {detected?.fileCheck?.status !== 'html' && <Button onClick={openInTab}>Open in new tab</Button>}
        <Button variant="contained" onClick={() => approve.mutate()} loading={approve.isPending}>
          Approve
        </Button>
        <Button color="error" onClick={() => reject.mutate()} loading={reject.isPending}>
          Reject
        </Button>
      </CardActions>
      <Dialog open={htmlPreview !== null} onClose={() => setHtmlPreview(null)} fullWidth maxWidth="lg">
        <DialogTitle>HTML syllabus preview (scripts off)</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <iframe
            title="Uploaded syllabus"
            sandbox=""
            srcDoc={htmlPreview || ''}
            style={{ width: '100%', height: '70vh', border: 0, background: '#fff' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHtmlPreview(null)}>Close</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={pdfData !== null} onClose={() => setPdfData(null)} fullWidth maxWidth="xl">
        <DialogTitle>PDF preview (scripts and links off)</DialogTitle>
        <DialogContent dividers sx={{ height: '80vh' }}>
          <ErrorBoundary message="Could not show this PDF">
            <Suspense fallback={<Typography>Loading viewer…</Typography>}>
              {pdfData && <PdfViewer data={pdfData} />}
            </Suspense>
          </ErrorBoundary>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPdfData(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

const MATCH_CHIP = { yes: { color: 'success', mark: '✓' }, no: { color: 'error', mark: '✗' }, unclear: { color: 'default', mark: '?' } };

// The AI's verdict on an upload (api/src/lib/ai.js). It only advises: the admin decides.
function AiCheck({ ai, running, error, onRun }) {
  const message = aiCheckMessage(ai);
  const button = (
    <Button size="small" color="inherit" onClick={onRun} loading={running}>
      {message ? 'Run again' : 'Run AI check'}
    </Button>
  );
  return (
    <>
      {message ? (
        <Alert severity={message.severity} sx={{ mt: 1 }} action={button}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {message.title}
          </Typography>
          <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
            {message.reasons.map((reason) => (
              <li key={reason}>
                <Typography variant="body2">{reason}</Typography>
              </li>
            ))}
          </ul>
          {message.matches.length > 0 && (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, my: 0.5 }}>
              {message.matches.map(({ field, value }) => (
                <Chip
                  key={field}
                  size="small"
                  variant="outlined"
                  color={MATCH_CHIP[value].color}
                  label={`${field} ${MATCH_CHIP[value].mark}`}
                  title={value === 'unclear' ? 'The file does not say' : value === 'yes' ? 'Matches' : 'Does not match'}
                />
              ))}
            </Stack>
          )}
          {message.footer && (
            <Typography variant="caption" color="text.secondary">
              {message.footer}
            </Typography>
          )}
        </Alert>
      ) : (
        <Stack direction="row" sx={{ mt: 1, alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            No AI check yet.
          </Typography>
          {button}
        </Stack>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error.message}
        </Alert>
      )}
    </>
  );
}

// Pick a course, then fix or remove any syllabus listed under it (scraped or uploaded).
function Published({ token }) {
  const [course, setCourse] = useState('');
  const { known } = useCourseLookup(course);
  const { data, isFetching, error } = useQuery({
    queryKey: ['admin-course', known?.code],
    queryFn: () => api.adminCourse(known.code, token),
    enabled: Boolean(known),
  });

  return (
    <>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Choose a course to move a syllabus to the right course, fix its term, section or professors, or take it
        down. Fixes to scraped syllabi stick: the weekly scrape won&apos;t undo them.
      </Typography>
      <CourseField value={course} onChange={setCourse} />
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error.message}
        </Alert>
      )}
      {known && data && !isFetching && data.offerings.length === 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          No syllabi listed for {known.display}.
        </Alert>
      )}
      <Stack spacing={3} sx={{ mt: 3 }}>
        {data &&
          groupByTerm(data.offerings).map((group) => (
            <div key={group.termKey}>
              <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                {group.label}
              </Typography>
              <Stack spacing={1}>
                {group.offerings.map((offering) => (
                  <OfferingRow key={offering.id} code={data.code} offering={offering} token={token} />
                ))}
              </Stack>
            </div>
          ))}
      </Stack>
    </>
  );
}

// Merges two spellings of one professor ("Gonzalez Hernandez, A" and "González, Ana")
// on every syllabus at once. A preview comes first; nothing changes until "Merge".
function Professors({ token }) {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(null);
  const [into, setInto] = useState('');
  const [preview, setPreview] = useState(null);
  const [merged, setMerged] = useState(null);
  const { data, error } = useQuery({ queryKey: ['admin-professors'], queryFn: () => api.adminProfessors(token) });
  const professors = useMemo(() => data?.professors || [], [data]);
  const byName = useMemo(() => new Map(professors.map((p) => [p.name, p])), [professors]);
  const groups = useMemo(() => likelySpellings(professors.map((p) => p.name)), [professors]);

  const choose = (nextFrom, nextInto) => {
    setFrom(nextFrom);
    setInto(nextInto);
    setPreview(null);
    setMerged(null);
  };
  const check = useMutation({
    mutationFn: () => api.mergeProfessors({ from, into }, token),
    onSuccess: (result) => setPreview(result.changes),
  });
  const merge = useMutation({
    mutationFn: () => api.mergeProfessors({ from, into, apply: true }, token),
    onSuccess: async (result) => {
      setMerged({ from, into, count: result.changes.length });
      setFrom(null);
      setInto('');
      setPreview(null);
      await Promise.all(
        ['admin-professors', 'admin-course', 'course', 'courses', 'professors', 'search'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] })
        )
      );
    },
  });
  const describe = (name) => {
    const p = byName.get(name);
    return p ? `${p.count} ${p.count === 1 ? 'syllabus' : 'syllabi'} · ${p.courses.join(', ')}` : 'New spelling';
  };
  const failure = error || check.error || merge.error;

  return (
    <>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Merge two spellings of one professor on every syllabus at once. Pick the spelling to replace and the one to
        keep (or type the full name). Scraped syllabi keep the fix, like edits in Published syllabi.
      </Typography>
      {groups.length > 0 && (
        <Stack direction="row" sx={{ mb: 2, flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Possible duplicates:
          </Typography>
          {groups.map(([keep, ...others]) =>
            others.map((other) => (
              <Chip key={other} size="small" label={`${other} → ${keep}`} onClick={() => choose(other, keep)} />
            ))
          )}
        </Stack>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Autocomplete
          sx={{ flex: 1 }}
          options={professors.map((p) => p.name)}
          value={from}
          onChange={(_, next) => choose(next, into)}
          renderOption={({ key, ...props }, name) => (
            <li key={key} {...props}>
              <span>
                <strong>{name}</strong>
                <Typography component="span" variant="body2" color="text.secondary">
                  &nbsp;· {describe(name)}
                </Typography>
              </span>
            </li>
          )}
          renderInput={(params) => (
            <TextField {...params} label="Replace this spelling" helperText={from ? describe(from) : ' '} />
          )}
        />
        <Autocomplete
          sx={{ flex: 1 }}
          freeSolo
          options={professors.map((p) => p.name).filter((name) => name !== from)}
          inputValue={into}
          onInputChange={(_, next) => {
            setInto(next);
            setPreview(null);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="With this name"
              placeholder="Last, First"
              helperText={into.trim() ? describe(into.trim()) : 'Last name, first name'}
            />
          )}
        />
      </Stack>
      {failure && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {failure.message}
        </Alert>
      )}
      {merged && (
        <Alert severity="success" sx={{ mt: 2 }}>
          Merged &quot;{merged.from}&quot; into &quot;{merged.into}&quot; on {merged.count}{' '}
          {merged.count === 1 ? 'syllabus' : 'syllabi'}.
        </Alert>
      )}
      {preview ? (
        <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
          <Typography sx={{ fontWeight: 700, mb: 1 }}>
            {preview.length} {preview.length === 1 ? 'syllabus' : 'syllabi'} will change:
          </Typography>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 3 }}>
            {preview.map((c) => (
              <Typography component="li" variant="body2" key={`${c.code}-${c.term}-${c.section}-${c.before.join()}`}>
                {displayCourse(c.code)} {c.term}, section {c.section}: {c.before.join('; ')} → {c.after.join('; ')}
              </Typography>
            ))}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button variant="contained" onClick={() => merge.mutate()} loading={merge.isPending}>
              Merge
            </Button>
            <Button onClick={() => setPreview(null)}>Cancel</Button>
          </Stack>
        </Paper>
      ) : (
        <Button
          variant="contained"
          sx={{ mt: 2 }}
          disabled={!from || !into.trim()}
          onClick={() => check.mutate()}
          loading={check.isPending}
        >
          Preview merge
        </Button>
      )}
    </>
  );
}

const SOURCES = { upload: 'Student upload', 'gmu-cs': 'Scraped', 'gmu-cs-filename': 'Scraped (from file name)' };

function OfferingRow({ code, offering, token }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [form, setForm] = useState(null);
  const refresh = () =>
    Promise.all(
      ['admin-course', 'course', 'courses', 'professors', 'search'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] })
      )
    );

  const save = useMutation({
    mutationFn: () => api.updateOffering({ code, id: offering.id, ...form }, token),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteOffering({ code, id: offering.id }, token),
    onSuccess: refresh,
  });

  function startEditing() {
    setForm({
      course: displayCourse(code),
      term: offering.termKey,
      section: offering.section,
      instructors: offering.instructors.join('; '),
      title: '',
    });
    setConfirming(false);
    setEditing(true);
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontWeight: 700 }}>{offering.instructors.join('; ')}</Typography>
          <Chip size="small" label={`Section ${offering.section}`} />
          <Chip size="small" variant="outlined" label={SOURCES[offering.source] || offering.source} />
          <Link href={syllabusUrl(offering.fileId)} target="_blank" rel="noopener" variant="body2">
            View syllabus
          </Link>
        </Stack>
        {editing && <DetailFields form={form} setForm={setForm} professorsField="instructors" />}
        {(save.error || remove.error) && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {(save.error || remove.error).message}
          </Alert>
        )}
        {confirming && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Take this syllabus off the site? This can&apos;t be undone from here.
          </Alert>
        )}
      </CardContent>
      <CardActions>
        {editing ? (
          <>
            <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending}>
              Save
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </>
        ) : confirming ? (
          <>
            <Button variant="contained" color="error" onClick={() => remove.mutate()} loading={remove.isPending}>
              Yes, delete
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button onClick={startEditing}>Edit</Button>
            <Button onClick={() => setSummaryOpen(true)}>{hasSummary(offering.summary?.summary) ? 'Summary' : 'Add summary'}</Button>
            <Button color="error" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </>
        )}
      </CardActions>
      {summaryOpen && (
        <SummaryEditor
          fileId={offering.fileId}
          record={offering.summary}
          token={token}
          onClose={() => setSummaryOpen(false)}
          onSaved={refresh}
        />
      )}
    </Card>
  );
}

const SUMMARY_FIELDS = [
  { field: 'overview', label: 'Overview', rows: 3 },
  { field: 'topics', label: 'Topics (one per line)', rows: 4 },
  { field: 'tools', label: 'Languages and tools (one per line)', rows: 2 },
  { field: 'grading', label: 'Grading (one per line, e.g. "Projects: 40%")', rows: 4 },
  { field: 'workload', label: 'Workload (one per line)', rows: 3 },
  { field: 'textbooks', label: 'Textbooks (one per line)', rows: 2 },
  { field: 'prerequisites', label: 'Background and prerequisites', rows: 2 },
  ...POLICIES.map(({ field, label }) => ({ field, label: `${label} policy`, rows: 2 })),
];

// Edit a syllabus summary by hand, or ask the AI for a new one. Cross-listed
// syllabi share one file, so a change shows under every course that lists it.
function SummaryEditor({ fileId, record, token, onClose, onSaved }) {
  const [form, setForm] = useState(() => summaryToForm(record?.summary));
  const save = useMutation({
    mutationFn: () => api.saveSummary(fileId, formToSummary(form), token),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
  });
  const regenerate = useMutation({
    mutationFn: () => api.regenerateSummary(fileId, token),
    onSuccess: async (fresh) => {
      setForm(summaryToForm(fresh.summary));
      await onSaved();
    },
  });
  const busy = save.isPending || regenerate.isPending;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Syllabus summary</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {record ? summaryCredit(record) : 'No summary yet. Regenerate asks the AI for one.'}
          {record?.editedBy && ` (${record.editedBy})`}. Students see this on the course page.
        </Typography>
        <Stack spacing={2}>
          {SUMMARY_FIELDS.map(({ field, label, rows }) => (
            <TextField
              key={field}
              label={label}
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              multiline
              minRows={rows}
              disabled={busy}
            />
          ))}
        </Stack>
        {(save.error || regenerate.error) && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {(save.error || regenerate.error).message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => regenerate.mutate()} loading={regenerate.isPending} disabled={save.isPending}>
          Regenerate
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending} disabled={regenerate.isPending}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
