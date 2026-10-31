import { Link as RouterLink } from 'react-router-dom';
import { Button, Stack, Typography } from '@mui/material';

export default function NotFound() {
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
