import { Box } from '@mui/material';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Same rules as the API's search terms: quoted phrases, then words, minus "-negations".
export function searchTerms(query) {
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);
  const words = query
    .replace(/"[^"]*"/g, ' ')
    .replace(/"/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !word.startsWith('-'));
  return [...phrases, ...words];
}

// Marks each search term in the text. Matches start at a word boundary, and single words
// match on their stem so "program" also marks "programming"; the whole word gets marked.
export default function Highlight({ text, terms }) {
  if (terms.length === 0) return text;
  const parts = terms.map((t) => (t.includes(' ') ? escape(t) : escape(t.slice(0, Math.max(5, t.length - 3)))));
  const pattern = new RegExp(`\\b((?:${parts.join('|')})[\\w'-]*)`, 'gi');
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <Box key={i} component="mark" sx={{ bgcolor: 'secondary.light', color: 'inherit', px: 0.25, borderRadius: 0.5 }}>
        {part}
      </Box>
    ) : (
      part
    )
  );
}
