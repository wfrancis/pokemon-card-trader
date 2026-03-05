import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Box, AppBar, Toolbar, Typography, Button, CircularProgress } from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ViewModuleIcon from '@mui/icons-material/ViewModule';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const CardExplorer = lazy(() => import('./pages/CardExplorer'));
const CardDetail = lazy(() => import('./pages/CardDetail'));

function NavBar() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <AppBar position="static" sx={{ bgcolor: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}>
      <Toolbar variant="dense" sx={{ minHeight: 42 }}>
        <ShowChartIcon sx={{ color: '#00ff41', mr: 1 }} />
        <Typography
          variant="h3"
          component={Link}
          to="/"
          sx={{
            color: '#00ff41',
            textDecoration: 'none',
            mr: 3,
            fontWeight: 700,
            letterSpacing: 2,
          }}
        >
          PKMN TRADER
        </Typography>
        <Button
          component={Link}
          to="/"
          startIcon={<DashboardIcon />}
          size="small"
          sx={{
            color: isActive('/') ? '#00bcd4' : '#666',
            textTransform: 'none',
            mr: 1,
          }}
        >
          Dashboard
        </Button>
        <Button
          component={Link}
          to="/explore"
          startIcon={<ViewModuleIcon />}
          size="small"
          sx={{
            color: isActive('/explore') ? '#00bcd4' : '#666',
            textTransform: 'none',
          }}
        >
          Explorer
        </Button>
      </Toolbar>
    </AppBar>
  );
}

function Loading() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
      <CircularProgress sx={{ color: '#00bcd4' }} />
    </Box>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Box sx={{ minHeight: '100vh', bgcolor: '#0a0a0a' }}>
        <NavBar />
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/explore" element={<CardExplorer />} />
            <Route path="/card/:id" element={<CardDetail />} />
          </Routes>
        </Suspense>
      </Box>
    </BrowserRouter>
  );
}
