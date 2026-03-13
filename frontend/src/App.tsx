import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  Button,
  CircularProgress,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import BookmarkIcon from '@mui/icons-material/Bookmark';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const CardExplorer = lazy(() => import('./pages/CardExplorer'));
const CardDetail = lazy(() => import('./pages/CardDetail'));
const Trader = lazy(() => import('./pages/Trader'));
const Watchlist = lazy(() => import('./pages/Watchlist'));

function NavBar() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navItems = [
    { label: 'Dashboard', path: '/', icon: <DashboardIcon /> },
    { label: 'Explorer', path: '/explore', icon: <ViewModuleIcon /> },
    { label: 'AI Trader', path: '/trader', icon: <SmartToyIcon /> },
    { label: 'Watchlist', path: '/watchlist', icon: <BookmarkIcon /> },
  ];

  return (
    <>
      <AppBar position="static" sx={{ bgcolor: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}>
        <Toolbar variant="dense" sx={{ minHeight: { xs: 48, md: 42 } }}>
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
              fontSize: { xs: '0.9rem', md: undefined },
            }}
          >
            PKMN TRADER
          </Typography>
          {!isMobile ? (
            <>
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
                  mr: 1,
                }}
              >
                Explorer
              </Button>
              <Button
                component={Link}
                to="/trader"
                startIcon={<SmartToyIcon />}
                size="small"
                sx={{
                  color: isActive('/trader') ? '#00bcd4' : '#666',
                  textTransform: 'none',
                }}
              >
                AI Trader
              </Button>
              <Button
                component={Link}
                to="/watchlist"
                startIcon={<BookmarkIcon />}
                size="small"
                sx={{
                  color: isActive('/watchlist') ? '#ffd700' : '#666',
                  textTransform: 'none',
                  ml: 1,
                }}
              >
                Watchlist
              </Button>
            </>
          ) : (
            <>
              <Box sx={{ flex: 1 }} />
              <IconButton onClick={() => setDrawerOpen(true)} sx={{ color: '#888' }}>
                <MenuIcon />
              </IconButton>
            </>
          )}
        </Toolbar>
      </AppBar>
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: { bgcolor: '#0a0a0a', borderLeft: '1px solid #1e1e1e', width: 240 },
        }}
      >
        <List sx={{ pt: 2 }}>
          {navItems.map(({ label, path, icon }) => (
            <ListItem key={path} disablePadding>
              <ListItemButton
                component={Link}
                to={path}
                onClick={() => setDrawerOpen(false)}
                sx={{
                  color: isActive(path) ? '#00bcd4' : '#888',
                  py: 1.5,
                  '&:hover': { bgcolor: '#1a1a1a' },
                }}
              >
                <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                  {icon}
                </ListItemIcon>
                <ListItemText
                  primary={label}
                  primaryTypographyProps={{
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    fontWeight: isActive(path) ? 600 : 400,
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Drawer>
    </>
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
            <Route path="/trader" element={<Trader />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Box>
    </BrowserRouter>
  );
}
