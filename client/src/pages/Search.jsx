import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, Link, Skeleton, Stack, TextField, Typography } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import { api, syllabusUrl } from '../api';
import Highlight, { searchTerms } from '../components/Highlight';
import { useSchool } from '../components/School';
import { displayCourse as display } from '../lib/courses';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [draft, setDraft] = useState(q);
  const { school } = useSchool();
  const { data, isFetching, error } = useQuery({
    queryKey: ['search', school.key, q],
    queryFn: () => api.search(q, school.key),
    enabled: q.trim().length >= 2,
  });
  const terms = searchTerms(q);

  return (
    <>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800, mb: 1 }}>
        Search inside syllabi
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Find {school.short} syllabi that mention a language, textbook, tool or policy. Use quotes for an exact phrase.
      </Typography>

      <Box
        component="form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(draft.trim() ? { q: draft.trim() } : {});
        }}
        sx={{ display: 'flex', gap: 1, mb: 3 }}
      >
        <TextField
          fullWidth
          autoFocus
          label="Search syllabus text"
          placeholder='Python, "late policy", zyBooks'
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" variant="contained" sx={{ flexShrink: 0 }}>
          Search
        </Button>
      </Box>

      {error && <Alert severity="error">{error.message}</Alert>}
      {isFetching && <Skeleton variant="rounded" height={160} />}
      {data && !isFetching && (
        <>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            {data.results.length === 0
              ? 'No syllabi mention '
              : `${data.results.length}${data.results.length === 20 ? '+' : ''} syllabi mention `}
            <Box component="strong" sx={{ color: 'text.primary' }}>
              {data.query}
            </Box>
          </Typography>
          <Stack spacing={1.5}>
            {data.results.map((r) => (
              <Card key={r.fileId} variant="outlined">
                <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                  <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                    {r.codes.map((code) => (
                      <Link key={code} component={RouterLink} to={`/courses/${code}`} sx={{ fontWeight: 700 }}>
                        {display(code)}
                      </Link>
                    ))}
                    <Typography component="span">{r.title}</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {r.termLabel} · Section {r.section} · {r.instructors.join(', ')}
                  </Typography>
                  <Typography variant="body2" sx={{ my: 1.5, overflowWrap: 'anywhere' }}>
                    <Highlight text={r.snippet} terms={terms} />
                  </Typography>
                  <Button size="small" variant="outlined" startIcon={<DescriptionIcon />} href={syllabusUrl(r.fileId)} target="_blank" rel="noopener">
                    View syllabus
                  </Button>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </>
      )}
    </>
  );
}
