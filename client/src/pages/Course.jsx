import { useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DescriptionIcon from '@mui/icons-material/Description';
import { api, syllabusUrl } from '../api';
import { groupByTerm, instructorsOf } from '../lib/terms';

const ALL = 'all';

export default function Course() {
  const { code } = useParams();
  const { data: course, isPending, error } = useQuery({ queryKey: ['course', code], queryFn: () => api.course(code) });
  const [term, setTerm] = useState(ALL);
  const [instructor, setInstructor] = useState(ALL);

  const offerings = useMemo(() => course?.offerings || [], [course]);
  const terms = useMemo(() => groupByTerm(offerings), [offerings]);
  const instructors = useMemo(() => instructorsOf(offerings), [offerings]);
  const visible = useMemo(
    () =>
      groupByTerm(
        offerings.filter(
          (o) => (term === ALL || o.termKey === term) && (instructor === ALL || o.instructors.includes(instructor))
        )
      ),
    [offerings, term, instructor]
  );

  if (isPending) return <Skeleton variant="rounded" height={240} />;
  if (error) {
    return (
      <Stack spacing={2}>
        <Alert severity={error.status === 404 ? 'info' : 'error'}>{error.message}</Alert>
        <UploadPrompt code={code} />
      </Stack>
    );
  }

  return (
    <>
      <Button component={RouterLink} to="/" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        All courses
      </Button>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        {course.display}
      </Typography>
      <Typography variant="h6" component="p" color="text.secondary" sx={{ mb: 3 }}>
        {course.title}
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField select label="Term" value={term} onChange={(e) => setTerm(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value={ALL}>All terms</MenuItem>
          {terms.map((t) => (
            <MenuItem key={t.termKey} value={t.termKey}>
              {t.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Professor"
          value={instructor}
          onChange={(e) => setInstructor(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value={ALL}>All professors</MenuItem>
          {instructors.map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Stack spacing={3}>
        {visible.map((group) => (
          <Box key={group.termKey} component="section">
            <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
              {group.label}
            </Typography>
            <Stack spacing={1}>
              {group.offerings.map((o) => (
                <Card key={o.fileId + o.section} variant="outlined">
                  <CardContent
                    sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', '&:last-child': { pb: 2 } }}
                  >
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600 }}>{o.instructors.join(', ')}</Typography>
                      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                        <Chip size="small" label={`Section ${o.section}`} />
                        {o.source === 'upload' && <Chip size="small" color="secondary" label="Student upload" />}
                        {o.source === 'gmu-cs-filename' && (
                          <Chip size="small" variant="outlined" label="Details from file name" />
                        )}
                      </Stack>
                    </Box>
                    <Button
                      variant="contained"
                      startIcon={<DescriptionIcon />}
                      href={syllabusUrl(o.fileId)}
                      target="_blank"
                      rel="noopener"
                    >
                      View syllabus
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </Box>
        ))}
        {visible.length === 0 && <Alert severity="info">No syllabi match those filters.</Alert>}
      </Stack>

      <Box sx={{ mt: 4 }}>
        <UploadPrompt code={code} />
      </Box>
    </>
  );
}

function UploadPrompt({ code }) {
  return (
    <Alert
      severity="success"
      variant="outlined"
      action={
        <Button component={RouterLink} to={`/upload?course=${encodeURIComponent(code)}`} color="inherit">
          Upload
        </Button>
      }
    >
      Have a syllabus for this course that&apos;s missing here? Share it.
    </Alert>
  );
}
