import { useMemo, useState } from 'react';
import { useSearchParams, Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Card, CardActionArea, FormControlLabel, Grid, Link, Skeleton, Stack, Switch, Typography } from '@mui/material';
import { api } from '../api';
import HomeSearch from '../components/HomeSearch';
import { useSchool } from '../components/School';
import { DEFAULT_SCHOOL } from '../lib/courses';
import { pickDepartment, sortDepartments } from '../lib/departments';

export default function Home() {
  const [params, setParams] = useSearchParams();
  const { school } = useSchool();
  const { data: deptData } = useQuery({
    queryKey: ['departments', school.key],
    queryFn: () => api.departments(school.key),
  });
  const departments = useMemo(() => sortDepartments(deptData?.departments || []), [deptData]);
  const dept = pickDepartment(departments, school.key, params.get('dept'));
  const { data, isPending, error } = useQuery({
    queryKey: ['courses', dept],
    queryFn: () => api.courses(dept),
    enabled: Boolean(dept),
  });
  const courses = data?.courses || [];
  const [onlyWithSyllabi, setOnlyWithSyllabi] = useState(false);
  const listed = onlyWithSyllabi ? courses.filter((c) => c.hasSyllabi) : courses;
  const withSyllabi = courses.filter((c) => c.hasSyllabi).length;
  const current = departments.find((d) => d.code === dept) || {
    code: dept || '',
    display: data?.display || '',
    name: data?.name || '',
    withSyllabi,
  };
  const gmu = school.key === DEFAULT_SCHOOL;
  // The address keeps the school and a department other than the default, so links can be shared.
  const pick = (d) =>
    setParams({ ...(!gmu && { school: school.key }), ...(!(gmu && d.code === 'CS') && { dept: d.display }) });

  return (
    <>
      <HomeSearch departments={departments} onSubject={pick} />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4, textAlign: 'center' }}>
        {gmu
          ? "Most syllabi so far are Computer Science, from GMU's old syllabus page. Every other department depends on students."
          : `${school.short} syllabi come from students, so the site starts with ${school.short}'s course catalog.`}{' '}
        <Link component={RouterLink} to="/upload">
          Upload one that&apos;s missing
        </Link>
        {' · '}
        <Link component={RouterLink} to="/search">
          Search inside syllabi
        </Link>
      </Typography>

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
