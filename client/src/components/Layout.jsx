import { Link as RouterLink, Outlet } from 'react-router-dom';
import { AppBar, Box, Button, Container, Link, Toolbar, Typography } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';

export default function Layout() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ gap: 1 }}>
          <MenuBookIcon aria-hidden />
          <Typography
            component={RouterLink}
            to="/"
            variant="h6"
            noWrap
            sx={{ flexGrow: 1, color: 'inherit', textDecoration: 'none', fontWeight: 700, fontSize: { xs: 16, sm: 20 } }}
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              GMU{' '}
            </Box>
            Syllabus Searcher
          </Typography>
          <Button component={RouterLink} to="/professors" color="inherit">
            Professors
          </Button>
          <Button
            component={RouterLink}
            to="/upload"
            color="secondary"
            variant="contained"
            disableElevation
            sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            Upload
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              &nbsp;a syllabus
            </Box>
          </Button>
        </Toolbar>
      </AppBar>

      <Container component="main" maxWidth="md" sx={{ py: 4, flexGrow: 1 }}>
        <Outlet />
      </Container>

      <Box component="footer" sx={{ py: 3, textAlign: 'center', color: 'text.secondary', fontSize: 14 }}>
        Computer Science syllabi only for now. Not affiliated with George Mason University.{' '}
        <Link component={RouterLink} to="/admin" color="inherit">
          Admin
        </Link>
      </Box>
    </Box>
  );
}
