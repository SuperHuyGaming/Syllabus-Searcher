import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, CardActions, CardContent, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api';
import { supabase } from '../supabase';
import { termLabel } from '../lib/terms';

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
  return <ReviewQueue token={session.access_token} email={session.user.email} />;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/admin`, shouldCreateUser: false },
      });
      if (error) throw error;
    },
  });

  return (
    <Paper
      variant="outlined"
      component="form"
      sx={{ p: 4, maxWidth: 420, mx: 'auto' }}
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <Typography variant="h5" component="h1" sx={{ mb: 2, fontWeight: 700 }}>
        Admin sign-in
      </Typography>
      {send.isSuccess ? (
        <Alert severity="success">Check your email for a sign-in link.</Alert>
      ) : (
        <Stack spacing={2}>
          <TextField type="email" label="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {send.isError && <Alert severity="error">{send.error.message}</Alert>}
          <Button type="submit" variant="contained" loading={send.isPending}>
            Email me a link
          </Button>
        </Stack>
      )}
    </Paper>
  );
}

function ReviewQueue({ token, email }) {
  const { data, isPending, error } = useQuery({ queryKey: ['pending'], queryFn: () => api.pendingUploads(token) });
  const uploads = data?.uploads || [];

  return (
    <>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, flexGrow: 1 }}>
          Pending uploads
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
          {email}
        </Typography>
        <Button onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </Stack>
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

function UploadCard({ upload, token }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const done = () => queryClient.invalidateQueries({ queryKey: ['pending'] });
  const approve = useMutation({ mutationFn: () => api.approve(upload.id, title, token), onSuccess: done });
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
          {upload.course_code} · {termLabel(upload.term_key)} · Section {upload.section}
        </Typography>
        <Typography color="text.secondary">{upload.instructor}</Typography>
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

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
          <TextField
            size="small"
            label="Course title (new courses only)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            sx={{ flexGrow: 1 }}
          />
          <TextField size="small" label="Reject reason" value={note} onChange={(e) => setNote(e.target.value)} />
        </Stack>
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
