import { Box, Chip, Stack, Typography } from '@mui/material';
import { POLICIES, summaryCredit } from '../lib/summary';

// The AI summary of one syllabus, shown under its card on the course page.
// `record` is { summary, provider, generatedAt, editedAt } from the API.
// The course rollup uses it too, as { rollup, provider, generatedAt, fileIds },
// with the overview shown above it rather than inside.
export default function SyllabusSummary({ record, hideOverview = false }) {
  const s = record.summary || record.rollup;
  const policies = POLICIES.filter(({ field }) => s.policies?.[field]);

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }} data-testid={record.rollup ? 'course-rollup-details' : 'syllabus-summary'}>
      {s.overview && !hideOverview && <Typography>{s.overview}</Typography>}
      <Part title={record.rollup ? 'Common topics' : 'Topics'} items={s.topics} chips />
      <Part title="Languages and tools" items={s.tools} chips />
      {s.grading?.length > 0 && (
        <Part title="Grading">
          <Box component="table" sx={{ borderCollapse: 'collapse', '& td': { py: 0.25, pr: 3, verticalAlign: 'top' } }}>
            <tbody>
              {s.grading.map((row) => (
                <tr key={row.item}>
                  <td>{row.item}</td>
                  <td>
                    <strong>{row.weight}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Part>
      )}
      <Part title="Workload" items={s.workload} />
      <Part title="Textbooks" items={s.textbooks} />
      <Part title="How professors differ" items={s.differences} />
      {s.prerequisites && <Part title="Background">{s.prerequisites}</Part>}
      {policies.length > 0 && (
        <Part title="Policies">
          {policies.map(({ field, label }) => (
            <Typography key={field} variant="body2">
              <strong>{label}:</strong> {s.policies[field]}
            </Typography>
          ))}
        </Part>
      )}
      <Typography variant="caption" color="text.secondary">
        {summaryCredit(record)}. It can miss or get things wrong, so check the syllabus itself.
      </Typography>
    </Box>
  );
}

function Part({ title, items, chips, children }) {
  if (!children && !items?.length) return null;
  return (
    <Box>
      <Typography variant="subtitle2" component="h3">
        {title}
      </Typography>
      {children && (typeof children === 'string' ? <Typography variant="body2">{children}</Typography> : children)}
      {items?.length > 0 &&
        (chips ? (
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            {items.map((item) => (
              <Chip key={item} size="small" variant="outlined" label={item} />
            ))}
          </Stack>
        ) : (
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {items.map((item) => (
              <Typography component="li" variant="body2" key={item}>
                {item}
              </Typography>
            ))}
          </Box>
        ))}
    </Box>
  );
}
