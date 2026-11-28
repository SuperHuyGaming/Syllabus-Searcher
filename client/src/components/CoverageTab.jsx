import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { api } from '../api';
import { useSchool } from './School';
import { normalizeCourse } from '../lib/courses';

function courseKey(code, schoolKey) {
  return normalizeCourse(code, schoolKey) || String(code || '').trim().toUpperCase();
}

function formatTimestamp(iso) {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function CoverageTab({ token }) {
  const { school } = useSchool();
  const { data, isPending, error } = useQuery({
    queryKey: ['admin-coverage', school.key],
    queryFn: () => api.adminCoverage(token, school.key),
  });
  const [expanded, setExpanded] = useState({});

  const departments = useMemo(() => {
    const list = data?.coverage?.departments || [];
    return [...list].sort(
      (a, b) => (b.withoutSyllabi || 0) - (a.withoutSyllabi || 0) || String(a.dept || '').localeCompare(String(b.dept || ''))
    );
  }, [data]);

  const hintsByCourse = useMemo(() => {
    const map = new Map();
    for (const hint of data?.hints || []) {
      const key = courseKey(hint.code, school.key);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(hint);
    }
    return map;
  }, [data, school.key]);

  if (isPending) return <Skeleton variant="rounded" height={180} />;
  if (error) return <Alert severity="error">{error.message}</Alert>;

  const report = data?.coverage;
  if (!report) {
    return (
      <Alert severity="info">
        No coverage report has been computed for {school.short} yet. Run the scraper with <code>--coverage</code> to
        generate one.
      </Alert>
    );
  }

  const toggle = (dept) => setExpanded((prev) => ({ ...prev, [dept]: !prev[dept] }));
  const totals = report.totals || { courses: 0, withSyllabi: 0, withoutSyllabi: 0 };

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="h6" component="h2">
              {school.short} syllabus coverage
            </Typography>
            <Chip size="small" label={`${totals.courses} total`} />
            <Chip size="small" color="success" label={`${totals.withSyllabi} with syllabi`} />
            <Chip size="small" color="warning" label={`${totals.withoutSyllabi} missing`} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Last computed: {formatTimestamp(report.computedAt)}
          </Typography>
        </Stack>
      </Paper>

      {departments.length === 0 ? (
        <Alert severity="info">No departments in this coverage report.</Alert>
      ) : (
        <Stack spacing={1.5}>
          {departments.map((dept) => {
            const isOpen = Boolean(expanded[dept.dept]);
            const missing = dept.missingCourses || [];
            const deptHints = missing.flatMap((code) => hintsByCourse.get(courseKey(code, school.key)) || []);
            return (
              <Card key={dept.dept} variant="outlined" data-testid={`coverage-dept-${dept.dept}`}>
                <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                  >
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                      <Typography sx={{ fontWeight: 700, minWidth: 64 }}>{dept.dept}</Typography>
                      <Chip size="small" variant="outlined" label={`${dept.courses} total`} />
                      <Chip size="small" color="success" variant="outlined" label={`${dept.withSyllabi} with syllabi`} />
                      <Chip size="small" color="warning" variant="outlined" label={`${dept.withoutSyllabi} missing`} />
                      {deptHints.length > 0 && (
                        <Chip
                          size="small"
                          color="info"
                          label={`${deptHints.length} online ${deptHints.length === 1 ? 'hint' : 'hints'}`}
                        />
                      )}
                    </Stack>
                    <Button
                      size="small"
                      onClick={() => toggle(dept.dept)}
                      aria-expanded={isOpen}
                      endIcon={isOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    >
                      {isOpen ? 'Hide missing' : `Show missing (${missing.length})`}
                    </Button>
                  </Stack>

                  <Collapse in={isOpen} unmountOnExit>
                    <Divider sx={{ my: 1.5 }} />
                    {missing.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        All courses in {dept.dept} have syllabi.
                      </Typography>
                    ) : (
                      <Stack spacing={1.5}>
                        <Box>
                          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                            Missing courses ({missing.length})
                          </Typography>
                          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                            {missing.map((code) => {
                              const hasHint = (hintsByCourse.get(courseKey(code, school.key)) || []).length > 0;
                              return (
                                <Chip
                                  key={code}
                                  size="small"
                                  label={hasHint ? `${code} · hint` : code}
                                  color={hasHint ? 'info' : 'default'}
                                  variant="outlined"
                                />
                              );
                            })}
                          </Stack>
                        </Box>

                        {deptHints.length > 0 && (
                          <Box>
                            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                              Online hints (admin only)
                            </Typography>
                            <Stack spacing={1}>
                              {deptHints.map((hint, idx) => (
                                <Paper key={`${hint.code}-${hint.host}-${idx}`} variant="outlined" sx={{ p: 1.25 }}>
                                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                      {hint.code}
                                    </Typography>
                                    {hint.host && <Chip size="small" label={hint.host} />}
                                    {hint.foundAt && (
                                      <Typography variant="caption" color="text.secondary">
                                        Spotted {formatTimestamp(hint.foundAt)}
                                      </Typography>
                                    )}
                                  </Stack>
                                  {hint.title && (
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {hint.title}
                                    </Typography>
                                  )}
                                  {hint.snippet && (
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                                      {hint.snippet}
                                    </Typography>
                                  )}
                                </Paper>
                              ))}
                            </Stack>
                          </Box>
                        )}
                      </Stack>
                    )}
                  </Collapse>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
