import { Link as RouterLink, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, Chip, Link, Skeleton, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { api } from '../api';
import SyllabusButtons from '../components/SyllabusButtons';
import { groupByTerm } from '../lib/terms';
import { findProfessor } from '../lib/professors';
import { rateMyProfessorsUrl } from '../lib/links';
import { useSchool } from '../components/School';

export default function Professor() {
  const { slug } = useParams();
  const { school } = useSchool();
  const { data, isPending, error } = useQuery({
    queryKey: ['professors', school.key],
    queryFn: () => api.professors(school.key),
  });

  if (isPending) return <Skeleton variant="rounded" height={240} />;
  if (error) return <Alert severity="error">{error.message}</Alert>;

  const professor = findProfessor(data.professors, slug);
  if (!professor) return <Alert severity="info">No professor found. They may be listed under a slightly different name.</Alert>;
  const rmpUrl = rateMyProfessorsUrl(professor.name, school.key);

  return (
    <>
      <Button component={RouterLink} to={school.key === 'gmu' ? '/professors' : `/professors?school=${school.key}`} startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        All professors
      </Button>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        {professor.name}
      </Typography>
      <Stack direction="row" spacing={2} useFlexGap sx={{ mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography color="text.secondary">
          {professor.offerings.length} syllabi across {professor.courses.length} courses
        </Typography>
        {rmpUrl && (
          <Link
            href={rmpUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            Rate My Professors <OpenInNewIcon sx={{ fontSize: 15 }} aria-hidden />
          </Link>
        )}
      </Stack>

      <Stack spacing={3}>
        {groupByTerm(professor.offerings).map((group) => (
          <Box key={group.termKey} component="section">
            <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
              {group.label}
            </Typography>
            <Stack spacing={1}>
              {group.offerings.map((o) => (
                <Card key={o.fileId + o.code + o.section} variant="outlined">
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', '&:last-child': { pb: 2 } }}>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Link component={RouterLink} to={`/courses/${o.code}`} sx={{ fontWeight: 700 }}>
                        {o.display}
                      </Link>{' '}
                      <Typography component="span" color="text.secondary">
                        {o.title}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 1 }}>
                        <Chip size="small" label={`Section ${o.section}`} />
                        {o.coInstructors.length > 0 && (
                          <Chip size="small" variant="outlined" label={`With ${o.coInstructors.join(', ')}`} />
                        )}
                      </Stack>
                    </Box>
                    <SyllabusButtons offering={o} />
                  </CardContent>
                </Card>
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>
    </>
  );
}
