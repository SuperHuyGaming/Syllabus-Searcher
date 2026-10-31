import { createTheme } from '@mui/material/styles';

// GMU green and gold
export const theme = createTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#006633' },
        secondary: { main: '#FFCC33', contrastText: '#1a1a1a' },
        background: { default: '#f6f7f5' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#4caf7a' },
        secondary: { main: '#FFCC33', contrastText: '#1a1a1a' },
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
});
