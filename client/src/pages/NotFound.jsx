import { Link as RouterLink } from 'react-router-dom';
import { Button, Stack, Typography } from '@mui/material';
import { SITE_NAME, usePageMeta } from '../lib/seo';

export default function NotFound() {
  usePageMeta({
    title: `Page not found · ${SITE_NAME}`,
    description: 'The page you requested could not be found.',
  });
  return (
    <Stack spacing={2} sx={{ alignItems: 'center', py: 8 }}>
      <Typography variant="h4" component="h1">
        Page not found
      </Typography>
      <Button component={RouterLink} to="/" variant="contained">
        Search syllabi
      </Button>
    </Stack>
  );
}
