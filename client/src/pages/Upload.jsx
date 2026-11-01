import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { api } from '../api';
import { recentTerms } from '../lib/terms';
import { CourseField, ProfessorField } from '../components/CourseFields';

const MAX_BYTES = 4 * 1024 * 1024;
// Some professors post the syllabus as a web page; the site makes a PDF copy of those.
const isHtml = (file) => file.type === 'text/html' || /\.html?$/i.test(file.name);
const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
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
    if (picked && !isPdf(picked) && !isHtml(picked)) return setFileError('Choose a PDF or HTML file.');
    if (picked && picked.size > MAX_BYTES) return setFileError('File must be under 4 MB.');
    setFile(picked);
  }

  function submit(e) {
    e.preventDefault();
    if (!file) return setFileError('Choose a PDF or HTML file.');
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
        <CourseField value={form.course} onChange={(course) => setForm((f) => ({ ...f, course }))} required />
        <TextField select label="Term" value={form.term} onChange={set('term')} required>
          {TERMS.map((t) => (
            <MenuItem key={t.key} value={t.label}>
              {t.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Section" placeholder="001" value={form.section} onChange={set('section')} required />
        <ProfessorField
          course={form.course}
          value={form.instructor}
          onChange={(instructor) => setForm((f) => ({ ...f, instructor }))}
          required
        />
        <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} sx={{ justifyContent: 'flex-start' }}>
          {file ? file.name : 'Choose PDF or HTML file (max 4 MB)'}
          <input type="file" accept="application/pdf,.pdf,text/html,.html,.htm" hidden onChange={pickFile} />
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
