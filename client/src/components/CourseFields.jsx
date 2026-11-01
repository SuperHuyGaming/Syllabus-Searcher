import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Autocomplete, Box, Chip, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api';
import { displayCourse, normalizeCourse } from '../lib/courses';
import { instructorsOf } from '../lib/terms';

// The course list, keyed by code, plus what the typed text resolves to.
export function useCourseLookup(text) {
  const { data } = useQuery({ queryKey: ['courses'], queryFn: api.courses, staleTime: 5 * 60 * 1000 });
  const courses = useMemo(() => data?.courses || [], [data]);
  const code = normalizeCourse(text);
  const known = code ? courses.find((c) => c.code === code) : null;
  return { courses, code, known, loaded: Boolean(data) };
}

// Course code input that suggests known courses and shows the title of the one typed,
// so "CS 580" vs "CS 584" is obvious before submitting.
export function CourseField({ value, onChange, label = 'Course code', required, size }) {
  const { courses, code, known, loaded } = useCourseLookup(value);

  let helperText = 'Pick from the list or type a code like CS 310';
  if (known) helperText = `${known.display} · ${known.title}`;
  else if (code && loaded) helperText = `${displayCourse(code)} isn't on the site yet. Double-check the code.`;

  return (
    <Autocomplete
      freeSolo
      options={courses}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.display)}
      renderOption={({ key, ...props }, option) => (
        <li key={key} {...props}>
          <strong>{option.display}</strong>&nbsp;· {option.title}
        </li>
      )}
      filterOptions={(options, { inputValue }) => {
        const q = inputValue.trim().toLowerCase().replace(/\s+/g, '');
        if (!q) return options.slice(0, 50);
        return options
          .filter((o) => o.code.toLowerCase().includes(q) || o.title.toLowerCase().replace(/\s+/g, '').includes(q))
          .slice(0, 50);
      }}
      inputValue={value}
      onInputChange={(_, next) => onChange(next)}
      onChange={(_, picked) => picked && onChange(typeof picked === 'string' ? picked : picked.display)}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder="CS 310"
          required={required}
          size={size}
          helperText={helperText}
        />
      )}
    />
  );
}

// Professor input that suggests the names already listed for this course, in the
// same "Last, F" form, so one person doesn't show up under two spellings.
export function ProfessorField({ course, value, onChange, label = 'Professor', required, size, helperText }) {
  const { known } = useCourseLookup(course);
  const { data } = useQuery({
    queryKey: ['course', known?.code],
    queryFn: () => api.course(known.code),
    enabled: Boolean(known),
  });
  const names = useMemo(
    () => instructorsOf(data?.offerings || []).filter((n) => !/^(staff|all|tba)/i.test(n)),
    [data]
  );

  return (
    <Box>
      <Autocomplete
        freeSolo
        openOnFocus
        options={names}
        inputValue={value}
        onInputChange={(_, next) => onChange(next)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder="Last, First"
            required={required}
            size={size}
            helperText={helperText ?? 'Last name, first name'}
          />
        )}
      />
      {names.length > 0 && (
        <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Already listed for {known.display}:
          </Typography>
          {names.slice(0, 8).map((name) => (
            <Chip key={name} size="small" label={name} onClick={() => onChange(name)} />
          ))}
        </Stack>
      )}
    </Box>
  );
}
