import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#00bcd4', // Electric blue
    },
    secondary: {
      main: '#ff9800',
    },
    success: {
      main: '#00ff41', // Terminal green
    },
    error: {
      main: '#ff1744', // Bright red
    },
    background: {
      default: '#0a0a0a',
      paper: '#121212',
    },
    text: {
      primary: '#e0e0e0',
      secondary: '#9e9e9e',
    },
  },
  typography: {
    fontFamily: '"JetBrains Mono", "Roboto Mono", "Courier New", monospace',
    h1: { fontWeight: 700, fontSize: '2rem' },
    h2: { fontWeight: 700, fontSize: '1.5rem' },
    h3: { fontWeight: 600, fontSize: '1.25rem' },
    h4: { fontWeight: 600, fontSize: '1.1rem' },
    body1: { fontSize: '0.875rem' },
    body2: { fontSize: '0.8rem' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#0a0a0a',
          scrollbarWidth: 'thin',
          scrollbarColor: '#333 #0a0a0a',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid #1e1e1e',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid #1e1e1e',
          padding: '8px 12px',
          fontSize: '0.8rem',
        },
      },
    },
  },
});

export default theme;
