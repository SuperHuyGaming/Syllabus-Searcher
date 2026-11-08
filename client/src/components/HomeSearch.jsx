import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Autocomplete, Box, InputAdornment, Link, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import SchoolIcon from '@mui/icons-material/School';
import ListIcon from '@mui/icons-material/ViewList';
import CourseIcon from '@mui/icons-material/Description';
import PersonIcon from '@mui/icons-material/Person';
import { api } from '../api';
import { coursePath, displayCourse } from '../lib/courses';
import { professorPath } from '../lib/professors';
import { matchSchools, subjectSuggestions } from '../lib/suggest';
import { schoolHome, useSchool } from './School';

// The text once the user stops typing for a moment, so search doesn't run on every key.
function useDebounced(value, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const ICONS = { Schools: SchoolIcon, Subjects: ListIcon, Courses: CourseIcon, Professors: PersonIcon };

// What each suggestion says: a title, a second line, and a count on the right.
function describe({ kind, item }) {
  if (kind === 'Schools') return { title: item.name, line: item.city || item.short };
  if (kind === 'Subjects')
    return {
      title: item.name,
      line: `${item.display} · ${item.courses} courses`,
      count: item.withSyllabi > 0 ? `${item.withSyllabi} with syllabi` : 'no syllabi yet',
      has: item.withSyllabi > 0,
    };
  if (kind === 'Courses')
    return { title: `${item.display} – ${item.title}`, line: 'Course', count: item.hasSyllabi ? 'has syllabi' : 'no syllabi yet', has: item.hasSyllabi };
  return { title: item.name, line: item.courses.map(displayCourse).join(', ') };
}

const WHITE_LINK = { color: 'inherit', textDecorationColor: 'inherit', font: 'inherit', fontWeight: 800, verticalAlign: 'baseline' };

// The home page's search, modeled on Rate My Professors: one box that first asks for the
// school, then finds subjects, courses and professors at it. The picked school is a link
// in the heading, so changing it is one click. `onSubject` lists a picked subject's courses.
export default function HomeSearch({ departments, onSubject }) {
  const { school, schools, chosen, setSchool } = useSchool();
  const navigate = useNavigate();
  const [mode, setMode] = useState(chosen ? 'subject' : 'school');
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const subjectMode = mode === 'subject';
  const typed = input.trim();
  const q = useDebounced(typed);

  const { data: found, isFetching } = useQuery({
    queryKey: ['find-courses', school.key, q],
    queryFn: () => api.findCourses(q, school.key),
    enabled: subjectMode && q.length >= 2,
    placeholderData: keepPreviousData,
  });
  const { data: people } = useQuery({
    queryKey: ['professors', school.key],
    queryFn: () => api.professors(school.key),
    enabled: subjectMode,
  });

  const options = subjectMode
    ? subjectSuggestions({
        departments,
        courses: typed.length >= 2 ? found?.courses || [] : [],
        professors: people?.professors || [],
        text: input,
      })
    : matchSchools(schools, input).map((s) => ({ kind: 'Schools', key: `s:${s.key}`, item: s }));

  // Switching between the school and subject search keeps the cursor in the box.
  const switched = useRef(false);
  useEffect(() => {
    if (switched.current) inputRef.current?.focus();
  }, [mode]);
  const switchTo = (next) => {
    switched.current = true;
    setInput('');
    setMode(next);
  };

  const choose = (option) => {
    setInput('');
    if (option.kind === 'Schools') {
      setSchool(option.item.key);
      navigate(schoolHome(option.item.key));
      switchTo('subject');
    } else if (option.kind === 'Subjects') {
      onSubject(option.item);
      inputRef.current?.blur();
    } else if (option.kind === 'Courses') {
      navigate(coursePath(option.item.code));
    } else {
      navigate(professorPath(option.item.slug, school.key));
    }
  };

  let noOptions = 'No school matches. More schools are coming.';
  if (subjectMode) noOptions = typed ? `Nothing at ${school.short} matches. Try a code like CS or a word from the name.` : 'Type a subject, course or professor';

  return (
    <Box
      sx={{
        background: 'linear-gradient(180deg, #0b3d24 0%, #0f5133 100%)',
        color: '#fff',
        borderRadius: 3,
        px: 2,
        py: { xs: 4, sm: 5 },
        mb: 2,
        textAlign: 'center',
      }}
    >
      <Typography component="h1" sx={{ fontSize: { xs: 24, sm: 32 }, lineHeight: 1.25, mb: 2.5, overflowWrap: 'anywhere' }}>
        {subjectMode ? (
          <>
            Find a <b>syllabus</b> at{' '}
            <Link component="button" type="button" title="Change school" onClick={() => switchTo('school')} sx={WHITE_LINK}>
              {school.name}
            </Link>
          </>
        ) : (
          <>
            Enter your <b>school</b> to find a syllabus
          </>
        )}
      </Typography>

      <Autocomplete
        options={options}
        value={null}
        inputValue={input}
        onInputChange={(_, next, reason) => reason !== 'reset' && setInput(next)}
        onChange={(_, option) => option && choose(option)}
        filterOptions={(x) => x}
        groupBy={subjectMode ? (o) => o.kind : undefined}
        getOptionLabel={(o) => describe(o).title}
        getOptionKey={(o) => o.key}
        isOptionEqualToValue={(a, b) => a.key === b.key}
        autoHighlight
        forcePopupIcon={false}
        loading={subjectMode && typed.length >= 2 && isFetching && !options.length}
        noOptionsText={noOptions}
        renderOption={({ key, ...props }, option) => {
          const Icon = ICONS[option.kind];
          const { title, line, count, has } = describe(option);
          return (
            <Box component="li" key={key} {...props} sx={{ gap: 1.5 }}>
              <Icon fontSize="small" color="action" aria-hidden />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography sx={{ fontWeight: 700, lineHeight: 1.3 }}>{title}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {line}
                </Typography>
              </Box>
              {count && (
                <Typography
                  variant="caption"
                  sx={{
                    flexShrink: 0,
                    fontWeight: 600,
                    px: 1,
                    py: 0.25,
                    borderRadius: 4,
                    bgcolor: has ? 'rgba(0, 102, 51, 0.12)' : 'action.hover',
                    color: has ? 'primary.main' : 'text.secondary',
                  }}
                >
                  {count}
                </Typography>
              )}
            </Box>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            inputRef={inputRef}
            autoFocus
            placeholder={subjectMode ? 'Subject, course or professor, e.g. CS 310' : 'Your school'}
            slotProps={{
              ...params.slotProps,
              input: {
                ...(params.slotProps?.input ?? params.InputProps),
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#17201b' }} />
                  </InputAdornment>
                ),
              },
              htmlInput: {
                ...(params.slotProps?.htmlInput ?? params.inputProps),
                'aria-label': subjectMode ? `Subject, course or professor at ${school.short}` : 'Your school',
              },
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: '#fff',
                color: '#17201b',
                borderRadius: '28px',
                pl: 2.5,
                fontSize: 18,
                boxShadow: '0 6px 24px rgba(0, 0, 0, 0.25)',
              },
              '& .MuiOutlinedInput-root.Mui-focused': { boxShadow: '0 0 0 3px #FFCC33, 0 6px 24px rgba(0, 0, 0, 0.25)' },
              '& .MuiOutlinedInput-notchedOutline, & .Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
              '& input::placeholder': { color: '#5d6a62', opacity: 1 },
            }}
          />
        )}
        sx={{ maxWidth: 560, mx: 'auto', textAlign: 'left' }}
      />

      <Typography sx={{ mt: 2, fontSize: 15 }}>
        {subjectMode ? (
          <Link component="button" type="button" onClick={() => switchTo('school')} sx={{ ...WHITE_LINK, fontWeight: 400 }}>
            I want a different school
          </Link>
        ) : (
          chosen && (
            <Link component="button" type="button" onClick={() => switchTo('subject')} sx={{ ...WHITE_LINK, fontWeight: 400 }}>
              Back to {school.name}
            </Link>
          )
        )}
      </Typography>
    </Box>
  );
}
