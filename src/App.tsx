// Main App component
import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from './context/AppContext';

// Lazy load pages for code splitting
const HomePage = React.lazy(() => import('./pages/HomePage'));
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const TripPlannerPage = React.lazy(() => import('./pages/TripPlannerPage'));
const HotelBookingPage = React.lazy(() => import('./pages/HotelBookingPage'));
const ItineraryPage = React.lazy(() => import('./pages/ItineraryPage'));
const EmergencyPage = React.lazy(() => import('./pages/EmergencyPage'));
const PlacePage = React.lazy(() => import('./pages/PlacePage'));

// Shared Components
import AppShell from './components/layout/AppShell';
import ErrorBoundary from './components/shared/ErrorBoundary';
import NetworkStatus from './components/shared/NetworkStatus';
import LoadingSpinner from './components/shared/LoadingSpinner';
import { GlobalLoadingManager } from './components/shared/GlobalLoadingManager';
// import PerformanceMonitor from './components/shared/PerformanceMonitor';

// Styles
import './styles/global.css';
import './components/ui/ui.css';

// Create a client for React Query with enhanced configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (renamed from cacheTime in v5)
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
});

const NotFound: React.FC = () => (
  <div className="page">
    <div className="surface empty-state">
      <div className="empty-state-icon"><Compass size={26} strokeWidth={1.6} /></div>
      <h3>This page took a wrong turn</h3>
      <p>The page you’re looking for doesn’t exist or has moved.</p>
      <Link to="/" className="btn btn-primary" style={{ marginTop: 'var(--space-3)' }}>Back to home</Link>
    </div>
  </div>
);

const App: React.FC = () => {
  // Start with whatever is in localStorage so there is no flash on refresh.
  const [isAuthenticated, setIsAuthenticated] = React.useState(() => !!localStorage.getItem('user'));

  // Use basename only in production
  const basename = import.meta.env.PROD ? '/travelsphere' : '/';

  // Sign-in, sign-out and guest mode all announce themselves with an auth-change event
  React.useEffect(() => {
    const checkAuth = () => setIsAuthenticated(!!localStorage.getItem('user'));
    window.addEventListener('auth-change', checkAuth);
    return () => window.removeEventListener('auth-change', checkAuth);
  }, []);

  return (

    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <GlobalLoadingManager>
            <Router basename={basename}>
              <NetworkStatus />
              <Suspense fallback={<div className="page-loading"><LoadingSpinner size="lg" message="Loading…" /></div>}>
                {isAuthenticated ? (
                  <AppShell>
                    <Suspense fallback={<div className="page-loading"><LoadingSpinner size="md" /></div>}>
                      <Routes>
                        <Route path="/login" element={<Navigate to="/" replace />} />
                        <Route path="/" element={<HomePage />} />
                        <Route path="/plan-trip" element={<TripPlannerPage />} />
                        <Route path="/places/:placeId" element={<PlacePage />} />
                        <Route path="/book-hotels" element={<HotelBookingPage />} />
                        <Route path="/itinerary" element={<ItineraryPage />} />
                        <Route path="/itinerary/:tripId" element={<ItineraryPage />} />
                        <Route path="/chat/*" element={<Navigate to="/" replace />} />
                        <Route path="/emergency-support" element={<EmergencyPage />} />
                        <Route path="/emergency-support/:tab" element={<EmergencyPage />} />
                        <Route path="/emergency-support/requests/:requestId" element={<EmergencyPage />} />
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </Suspense>
                  </AppShell>
                ) : (
                  <Routes>
                    <Route path="*" element={<LoginPage />} />
                  </Routes>
                )}
              </Suspense>
            </Router>
          </GlobalLoadingManager>
        </AppProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;