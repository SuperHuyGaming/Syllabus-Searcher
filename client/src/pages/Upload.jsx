import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { api } from '../api';
import { recentTerms } from '../lib/terms';

const MAX_BYTES = 4 * 1024 * 1024;
const TERMS = recentTerms();

export default function Upload() {
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    course: params.get('course') || '',
    term: TERMS[0].label,
    section: '',
    instructor: '',
  });
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const upload = useMutation({ mutationFn: api.upload });

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function pickFile(e) {
    const picked = e.target.files?.[0] || null;
    setFileError('');
    if (picked && picked.type !== 'application/pdf') return setFileError('Choose a PDF file.');
    if (picked && picked.size > MAX_BYTES) return setFileError('PDF must be under 4 MB.');
    setFile(picked);
  }

  function submit(e) {
    e.preventDefault();
    if (!file) return setFileError('Choose a PDF file.');
    upload.mutate({ ...form, file });
  }

  if (upload.isSuccess) {
    return (
      <Alert severity="success">
        Thanks! Your syllabus is waiting for review and will show up once it&apos;s approved.
      </Alert>
    );
  }

  return (
    <Paper variant="outlined" component="form" onSubmit={submit} sx={{ p: { xs: 2, sm: 4 } }}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
        Upload a syllabus
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        No account needed. Uploads are checked before they appear on the site.
      </Typography>

      <Stack spacing={2}>
        <TextField label="Course code" placeholder="CS 310" value={form.course} onChange={set('course')} required />
        <TextField select label="Term" value={form.term} onChange={set('term')} required>
          {TERMS.map((t) => (
            <MenuItem key={t.key} value={t.label}>
              {t.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Section" placeholder="001" value={form.section} onChange={set('section')} required />
        <TextField
          label="Professor"
          placeholder="Last, First"
          value={form.instructor}
          onChange={set('instructor')}
          required
        />
        <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} sx={{ justifyContent: 'flex-start' }}>
          {file ? file.name : 'Choose PDF (max 4 MB)'}
          <input type="file" accept="application/pdf" hidden onChange={pickFile} />
        </Button>
        {fileError && <Alert severity="warning">{fileError}</Alert>}
        {upload.isError && <Alert severity="error">{upload.error.message}</Alert>}
        <Button type="submit" variant="contained" size="large" loading={upload.isPending}>
          Submit for review
        </Button>
      </Stack>
    </Paper>
  );
}
