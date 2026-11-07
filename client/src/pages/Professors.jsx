import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Card,
  CardActionArea,
  Grid,
  InputAdornment,
  Skeleton,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../api';
import { matchProfessors, professorPath } from '../lib/professors';
import { displayCourse as display } from '../lib/courses';
import { useSchool } from '../components/School';

export default function Professors() {
  const { school } = useSchool();
  const { data, isPending, error } = useQuery({
    queryKey: ['professors', school.key],
    queryFn: () => api.professors(school.key),
  });
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const all = data?.professors || [];
  const professors = matchProfessors(all, query);

  return (
    <>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 800, mb: 1 }}>
        Professors
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Every {school.short} professor with a syllabus on file, and the courses they&apos;ve taught.
      </Typography>

      {/* Type a first or last name; pick a suggestion (click or Enter) to open that professor. */}
      <Autocomplete
        freeSolo
        options={all}
        filterOptions={(options, { inputValue }) => (inputValue.trim() ? matchProfessors(options, inputValue, 8) : [])}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
        inputValue={query}
        onInputChange={(_, next, reason) => reason !== 'reset' && setQuery(next)}
        onChange={(_, picked) => picked && typeof picked !== 'string' && navigate(professorPath(picked.slug, school.key))}
        renderOption={({ key, ...props }, option) => (
          <Box component="li" key={key} {...props} sx={{ display: 'block !important' }}>
            <Typography sx={{ fontWeight: 700 }}>{option.name}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {option.courses.map(display).join(', ')}
            </Typography>
          </Box>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            autoFocus
            label="Search by first or last name"
            placeholder="e.g. Ziwei, Zhu, or David Gonzalez"
            slotProps={{
              ...params.slotProps,
              input: {
                ...(params.slotProps?.input ?? params.InputProps),
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              },
            }}
          />
        )}
        sx={{ mb: 3 }}
      />

      {error && <Alert severity="error">Couldn&apos;t load professors: {error.message}</Alert>}
      <Grid container spacing={1.5}>
        {isPending &&
          Array.from({ length: 9 }, (_, i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
              <Skeleton variant="rounded" height={72} />
            </Grid>
          ))}
        {professors.map((p) => (
          <Grid key={p.slug} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardActionArea component={RouterLink} to={professorPath(p.slug, school.key)} sx={{ p: 1.5, height: '100%' }}>
                <Typography sx={{ fontWeight: 700 }}>{p.name}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {p.courses.map(display).join(', ')}
                </Typography>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
      {!isPending && !error && professors.length === 0 && <Alert severity="info">No professors match “{query}”.</Alert>}
    </>
  );
}
