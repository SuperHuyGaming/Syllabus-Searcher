import { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Card,
  CardActionArea,
  FormControlLabel,
  Grid,
  Link,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api';

export default function Home() {
  const navigate = useNavigate();
  const { data, isPending, error } = useQuery({ queryKey: ['courses'], queryFn: api.courses });
  const courses = data?.courses || [];
  const [onlyWithSyllabi, setOnlyWithSyllabi] = useState(false);
  const listed = onlyWithSyllabi ? courses.filter((c) => c.hasSyllabi) : courses;
  const withSyllabi = courses.filter((c) => c.hasSyllabi).length;

  return (
    <>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h3" component="h1" sx={{ fontWeight: 800, fontSize: { xs: 32, sm: 44 } }}>
          Find a syllabus
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Search a GMU CS course to see who taught it each term and read their syllabus.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          GMU&apos;s syllabus page has been offline since 2025, so newer terms come from students.{' '}
          <Link component={RouterLink} to="/upload">
            Upload one that&apos;s missing
          </Link>
        </Typography>
      </Box>

      <Autocomplete
        options={courses}
        loading={isPending}
        getOptionLabel={(c) => `${c.display} – ${c.title}`}
        filterOptions={(options, { inputValue }) => {
          const q = inputValue.toLowerCase().replace(/\s+/g, '');
          return options.filter((c) => `${c.code}${c.title}`.toLowerCase().replace(/\s+/g, '').includes(q));
        }}
        onChange={(_, course) => course && navigate(`/courses/${course.code}`)}
        renderInput={(params) => (
          <TextField {...params} autoFocus label="Course code or name" placeholder="CS 310 or Data Structures" />
        )}
        sx={{ mb: 1.5 }}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 5, textAlign: 'center' }}>
        Looking for a language, textbook or policy?{' '}
        <Link component={RouterLink} to="/search">
          Search inside syllabi
        </Link>
      </Typography>

      {error && <Alert severity="error">Couldn&apos;t load courses: {error.message}</Alert>}

      <Stack direction="row" sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', columnGap: 2 }}>
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          All CS courses
          {!isPending && (
            <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>
              {withSyllabi} of {courses.length} have syllabi
            </Typography>
          )}
        </Typography>
        <FormControlLabel
          control={<Switch checked={onlyWithSyllabi} onChange={(e) => setOnlyWithSyllabi(e.target.checked)} />}
          label="Only with syllabi"
        />
      </Stack>
      <Grid container spacing={1.5}>
        {isPending &&
          Array.from({ length: 9 }, (_, i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
              <Skeleton variant="rounded" height={72} />
            </Grid>
          ))}
        {listed.map((course) => (
          <Grid key={course.code} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardActionArea component={RouterLink} to={`/courses/${course.code}`} sx={{ p: 1.5, height: '100%' }}>
                <Typography sx={{ fontWeight: 700 }}>{course.display}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {course.title}
                </Typography>
                {!course.hasSyllabi && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    No syllabi yet
                  </Typography>
                )}
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
      {!isPending && !error && courses.length === 0 && (
        <Alert severity="info">No syllabi yet. Run the scraper or upload one.</Alert>
      )}
    </>
  );
}
