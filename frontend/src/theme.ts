import { createTheme } from '@mui/material/styles';

let theme = createTheme({
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
          '@media (max-width: 600px)': {
            padding: '6px 8px',
            fontSize: '0.75rem',
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          '@media (max-width: 900px)': {
            minHeight: 44,
          },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          '@media (max-width: 900px)': {
            minHeight: 36,
            padding: '6px 10px',
          },
        },
      },
    },
  },
});

// Responsive typography — smaller headings on mobile, unchanged on md+
theme = createTheme(theme, {
  typography: {
    h1: { [theme.breakpoints.down('md')]: { fontSize: '1.4rem' } },
    h2: { [theme.breakpoints.down('md')]: { fontSize: '1.1rem' } },
    h3: { [theme.breakpoints.down('md')]: { fontSize: '1rem' } },
    h4: { [theme.breakpoints.down('md')]: { fontSize: '0.95rem' } },
  },
});

export default theme;
