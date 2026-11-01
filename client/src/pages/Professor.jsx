import { Link as RouterLink, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Card, CardContent, Chip, Link, Skeleton, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DescriptionIcon from '@mui/icons-material/Description';
import { api } from '../api';
import SyllabusButtons from '../components/SyllabusButtons';
import { groupByTerm } from '../lib/terms';
import { findProfessor } from '../lib/professors';

export default function Professor() {
  const { slug } = useParams();
  const { data, isPending, error } = useQuery({ queryKey: ['professors'], queryFn: api.professors });

  if (isPending) return <Skeleton variant="rounded" height={240} />;
  if (error) return <Alert severity="error">{error.message}</Alert>;

  const professor = findProfessor(data.professors, slug);
  if (!professor) return <Alert severity="info">No professor found. They may be listed under a slightly different name.</Alert>;

  return (
    <>
      <Button component={RouterLink} to="/professors" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        All professors
      </Button>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
        {professor.name}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {professor.offerings.length} syllabi across {professor.courses.length} courses
      </Typography>

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
