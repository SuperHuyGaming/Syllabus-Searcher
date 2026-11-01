import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
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
import { CourseField, ProfessorField, useCourseLookup } from '../components/CourseFields';

// Admins may need to fix syllabi older than the upload form's Fall 2022 cutoff.
const ADMIN_TERMS = recentTerms(new Date(), '2015-1');

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
      </Tabs>
      {tab === 'pending' ? <ReviewQueue token={token} /> : <Published token={token} />}
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
      {professorsField === 'instructor' ? (
        <ProfessorField size="small" course={form.course} value={form.instructor} onChange={set('instructor')} />
      ) : (
        <ProfessorField
          size="small"
          label="Professors"
          course={form.course}
          value={form.instructors}
          onChange={set('instructors')}
          helperText='Separate several professors with ";" (e.g. "Zhu, Z; Yu, F")'
        />
      )}
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
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['pending'] });
    queryClient.invalidateQueries({ queryKey: ['course'] });
    queryClient.invalidateQueries({ queryKey: ['courses'] });
  };
  const approve = useMutation({ mutationFn: () => api.approve(upload.id, form, token), onSuccess: done });
  const reject = useMutation({ mutationFn: () => api.reject(upload.id, note, token), onSuccess: done });
  const failure = approve.error || reject.error;

  // The PDF needs the admin token, so fetch it and open it as a local blob.
  async function openFile() {
    const blob = await api.pendingFile(upload.id, token);
    window.open(URL.createObjectURL(blob), '_blank', 'noopener');
  }

  const detected = upload.detected;
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

        {detected && !detected.error && (
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2">Azure found:</Typography>
            {[...detected.courseCodes, ...detected.terms].map((value) => (
              <Chip key={value} size="small" label={value} />
            ))}
          </Stack>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Open the PDF and fix anything that doesn&apos;t match before approving.
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
        {failure && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {failure.message}
          </Alert>
        )}
      </CardContent>
      <CardActions>
        <Button onClick={openFile}>Open PDF</Button>
        <Button variant="contained" onClick={() => approve.mutate()} loading={approve.isPending}>
          Approve
        </Button>
        <Button color="error" onClick={() => reject.mutate()} loading={reject.isPending}>
          Reject
        </Button>
      </CardActions>
    </Card>
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

const SOURCES = { upload: 'Student upload', 'gmu-cs': 'Scraped', 'gmu-cs-filename': 'Scraped (from file name)' };

function OfferingRow({ code, offering, token }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
            <Button color="error" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </>
        )}
      </CardActions>
    </Card>
  );
}
