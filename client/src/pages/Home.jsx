import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link as RouterLink } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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

// The text once the user stops typing for a moment, so search doesn't run on every key.
function useDebounced(value, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

// Finds a course in any department by code ("math 113") or title ("calculus").
function CourseSearch() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const q = useDebounced(input.trim());
  const { data, isFetching } = useQuery({
    queryKey: ['find-courses', q],
    queryFn: () => api.findCourses(q),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
  });
  const options = input.trim().length >= 2 ? data?.courses || [] : [];

  return (
    <Autocomplete
      options={options}
      loading={isFetching}
      filterOptions={(x) => x}
      getOptionLabel={(c) => `${c.display} – ${c.title}`}
      isOptionEqualToValue={(a, b) => a.code === b.code}
      inputValue={input}
      onInputChange={(_, next) => setInput(next)}
      onChange={(_, course) => course && navigate(`/courses/${course.code}`)}
      noOptionsText={input.trim().length < 2 ? 'Type a course code or name' : 'No GMU course matches'}
      renderOption={({ key, ...props }, c) => (
        <li key={key} {...props}>
          <Box>
            <strong>{c.display}</strong> – {c.title}
            {!c.hasSyllabi && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, fontStyle: 'italic' }}>
                no syllabi yet
              </Typography>
            )}
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField {...params} autoFocus label="Course code or name" placeholder="CS 310, MATH 113 or Calculus" />
      )}
      sx={{ mb: 1.5 }}
    />
  );
}

// Departments with syllabi first, then the rest, each A to Z.
function sortDepartments(departments) {
  return [...departments].sort(
    (a, b) => Number(b.withSyllabi > 0) - Number(a.withSyllabi > 0) || a.name.localeCompare(b.name)
  );
}

export default function Home() {
  const [params, setParams] = useSearchParams();
  const dept = (params.get('dept') || 'CS').toUpperCase();
  const { data: deptData } = useQuery({ queryKey: ['departments'], queryFn: api.departments });
  const departments = useMemo(() => sortDepartments(deptData?.departments || []), [deptData]);
  const { data, isPending, error } = useQuery({ queryKey: ['courses', dept], queryFn: () => api.courses(dept) });
  const courses = data?.courses || [];
  const [onlyWithSyllabi, setOnlyWithSyllabi] = useState(false);
  const listed = onlyWithSyllabi ? courses.filter((c) => c.hasSyllabi) : courses;
  const withSyllabi = courses.filter((c) => c.hasSyllabi).length;
  const current = departments.find((d) => d.code === dept) || { code: dept, name: data?.name || dept, withSyllabi };

  return (
    <>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h3" component="h1" sx={{ fontWeight: 800, fontSize: { xs: 32, sm: 44 } }}>
          Find a syllabus
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Search any GMU course to see who taught it each term and read their syllabus.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Most syllabi so far are Computer Science, from GMU&apos;s old syllabus page. Every other department
          depends on students.{' '}
          <Link component={RouterLink} to="/upload">
            Upload one that&apos;s missing
          </Link>
        </Typography>
      </Box>

      <CourseSearch />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 5, textAlign: 'center' }}>
        Looking for a language, textbook or policy?{' '}
        <Link component={RouterLink} to="/search">
          Search inside syllabi
        </Link>
      </Typography>

      <Autocomplete
        options={departments.length ? departments : [current]}
        value={current}
        disableClearable
        groupBy={(d) => (d.withSyllabi > 0 ? 'Have syllabi' : 'No syllabi yet')}
        getOptionLabel={(d) => `${d.name} (${d.code})`}
        isOptionEqualToValue={(a, b) => a.code === b.code}
        onChange={(_, d) => d && setParams(d.code === 'CS' ? {} : { dept: d.code })}
        renderOption={({ key, ...props }, d) => (
          <li key={key} {...props}>
            <Box sx={{ flexGrow: 1 }}>
              {d.name} ({d.code})
            </Box>
            {d.withSyllabi > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {d.withSyllabi} with syllabi
              </Typography>
            )}
          </li>
        )}
        renderInput={(params) => <TextField {...params} label="Department" />}
        sx={{ mb: 2, maxWidth: 480 }}
      />

      {error && <Alert severity="error">Couldn&apos;t load courses: {error.message}</Alert>}

      <Stack direction="row" sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', columnGap: 2 }}>
        <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
          All {current.name} courses
          {!isPending && !error && (
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
        <Alert severity="info">No courses listed for {current.name} yet.</Alert>
      )}
      {!isPending && !error && onlyWithSyllabi && courses.length > 0 && listed.length === 0 && (
        <Alert severity="info">
          No {current.name} syllabi yet.{' '}
          <Link component={RouterLink} to="/upload">
            Upload the first one
          </Link>
        </Alert>
      )}
    </>
  );
}
