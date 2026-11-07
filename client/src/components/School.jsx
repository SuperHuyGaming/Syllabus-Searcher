import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MenuItem, TextField } from '@mui/material';
import { api } from '../api';
import { DEFAULT_SCHOOL, schoolOf } from '../lib/courses';

const STORAGE_KEY = 'school';
const GMU = { key: DEFAULT_SCHOOL, name: 'George Mason University', short: 'GMU' };

// Browser storage can be missing or blocked (private windows); the site works without it.
function remembered() {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_SCHOOL;
  } catch {
    return DEFAULT_SCHOOL;
  }
}

function remember(key) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Not saved; the school is still picked for this visit.
  }
}

const SchoolContext = createContext(null);

// The school being browsed, read from the address when it says: a course page's code
// names its school ("/courses/unc:COMP110"), other pages may carry "?school=unc" (shared
// links). Otherwise it's the school this browser picked last, then GMU.
export function SchoolProvider({ children }) {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const course = pathname.match(/^\/courses\/([^/]+)/);
  const fromAddress = course ? schoolOf(decodeURIComponent(course[1])) : params.get('school')?.toLowerCase() || null;

  const [picked, setPicked] = useState(() => fromAddress || remembered());
  // Following a link to another school makes it the one picked, for the pages after it.
  const [seen, setSeen] = useState(fromAddress);
  if (fromAddress !== seen) {
    setSeen(fromAddress);
    if (fromAddress) setPicked(fromAddress);
  }
  const key = fromAddress || picked;
  useEffect(() => remember(key), [key]);

  const { data } = useQuery({ queryKey: ['schools'], queryFn: api.schools, staleTime: 60 * 60 * 1000 });
  const value = useMemo(() => {
    const schools = data?.schools?.length ? data.schools : [GMU];
    // Until the list loads, the key alone is enough to fetch with. After that, an unknown
    // key (a school taken off the site, a typo in a link) falls back to GMU.
    const school = schools.find((s) => s.key === key) || (data ? GMU : { ...GMU, key, short: key.toUpperCase(), name: key });
    return { school, schools, setSchool: setPicked };
  }, [data, key]);
  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}

export function useSchool() {
  return useContext(SchoolContext);
}

// The header's school picker. Picking one starts over on its home page.
export function SchoolPicker() {
  const { school, schools, setSchool } = useSchool();
  const navigate = useNavigate();
  if (schools.length < 2) return null;
  return (
    <TextField
      select
      size="small"
      value={school.key}
      onChange={(e) => {
        setSchool(e.target.value);
        navigate(e.target.value === DEFAULT_SCHOOL ? '/' : `/?school=${e.target.value}`);
      }}
      slotProps={{ htmlInput: { 'aria-label': 'School' } }}
      sx={{
        minWidth: 0,
        '& .MuiInputBase-root': { color: 'inherit', fontWeight: 600 },
        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.5)' },
        '& .MuiSvgIcon-root': { color: 'inherit' },
      }}
    >
      {schools.map((s) => (
        <MenuItem key={s.key} value={s.key}>
          {s.short}
        </MenuItem>
      ))}
    </TextField>
  );
}
