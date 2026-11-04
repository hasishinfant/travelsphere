import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  House, Compass, Luggage, BedDouble, LifeBuoy,
  Plus, ChevronRight, ChevronDown, LogOut, Menu, X,
} from 'lucide-react';
import { DESTINATIONS, DESTINATION_GROUPS } from '@/data/destinations';
import { getUser, getTrips, splitTrips, initials, firstName, isProfileComplete, fmtDay, type UserProfile } from '@/services/tripStore';
import { api, ensureSession, setSession } from '@/services/apiClient';
import { refreshJourneys, clearJourneyCache, TRIPS_EVENT } from '@/services/journeySync';
import { useConditions, LEVEL_LABEL } from '@/services/conditions';
import './AppShell.css';

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/plan-trip', label: 'Plan a trip', icon: Compass },
  { to: '/itinerary', label: 'My trips', icon: Luggage },
  { to: '/book-hotels', label: 'Hotels', icon: BedDouble },
  { to: '/emergency-support', label: 'Emergency', icon: LifeBuoy },
];

const TABS = NAV;

const useUser = () => {
  const [user, setUser] = useState<UserProfile | null>(getUser);
  useEffect(() => {
    const sync = () => setUser(getUser());
    window.addEventListener('auth-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('auth-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return user;
};

/* --------------------------------------------------------------------------
   Safety card — current journey + SOS
   -------------------------------------------------------------------------- */
const SafetyCard: React.FC<{ onNavigate: () => void }> = ({ onNavigate }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Re-read on navigation and whenever trips change (planner, server sync, cancellation)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    window.addEventListener(TRIPS_EVENT, bump);
    return () => window.removeEventListener(TRIPS_EVENT, bump);
  }, []);
  const upcoming = useMemo(() => splitTrips(getTrips()).upcoming.slice(0, 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location.pathname, tick]);
  const current = upcoming[0];
  const conditions = useConditions();
  const live = current?.destination && conditions.state === 'ready' ? conditions.byPlace[current.destination.id] : undefined;
  const statusText = conditions.state === 'signed-out'
    ? 'Sign in for live conditions'
    : !current ? 'Open a destination for live safety'
    : !current.destination ? 'No live conditions for this trip'
    : conditions.state === 'loading' ? 'Checking live conditions…'
    : live?.risk_level ? `${LEVEL_LABEL[live.risk_level]} · ${live.factors_available}/8 data`
    : 'Live conditions unavailable';
  const tone = live?.risk_level ? live.risk_level.toLowerCase() : 'none';

  return (
    <section className="safety-card" aria-label="Journey safety">
      <p className="safety-card-label">safety</p>
      <h2 className="safety-card-title">{current ? current.title : 'No active journey'}</h2>
      {current?.destination ? (
        <button
          type="button"
          className={`safety-card-status tone-${tone}`}
          onClick={() => { navigate(`/places/${current.destination!.id}`); onNavigate(); }}
          title={live?.headline}
        >
          <span className="safety-dot" aria-hidden="true" />
          {statusText}
        </button>
      ) : (
        <p className="safety-card-status">
          <span className="safety-dot" aria-hidden="true" />
          {statusText}
        </p>
      )}

      <button
        type="button"
        className="sos-btn"
        onClick={() => { navigate('/emergency-support'); onNavigate(); }}
        aria-label="SOS — report an incident"
      >
        SOS
      </button>
      <p className="sos-caption">Report an incident</p>

      {upcoming.length > 0 && (
        <ul className="safety-trips">
          {upcoming.map(t => (
            <li key={t.id}>
              <button
                type="button"
                className={`safety-trip ${location.pathname === t.path ? 'is-active' : ''}`}
                onClick={() => { navigate(t.path); onNavigate(); }}
              >
                <span className="safety-trip-thumb" aria-hidden="true">
                  <img src={`${t.image.split('?')[0]}?auto=format&fit=crop&w=64&h=64&q=60`} alt="" loading="lazy" />
                </span>
                <span className="safety-trip-name">
                  {t.title} <span>{fmtDay(t.startDate)}</span>
                </span>
                <ChevronRight size={16} className="safety-trip-chev" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/* --------------------------------------------------------------------------
   Sidebar
   -------------------------------------------------------------------------- */
const Sidebar: React.FC<{ user: UserProfile | null; onNavigate: () => void; onSignOut: () => void }> = ({
  user, onNavigate, onSignOut,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showAll, setShowAll] = useState(false);
  const activeRegion = location.pathname === '/' ? new URLSearchParams(location.search).get('region') : null;
  const groups = showAll ? DESTINATION_GROUPS : DESTINATION_GROUPS.slice(0, 3);

  return (
    <div className="sidebar-inner">
      <div className="profile">
        <button
          type="button"
          className="profile-avatar"
          onClick={() => { navigate('/?profile=edit'); onNavigate(); }}
          aria-label="Edit profile"
        >
          {initials(user?.name)}
          {!isProfileComplete(user) && <span className="profile-dot" aria-label="Profile incomplete" />}
        </button>
        <div className="profile-text">
          <p className="profile-name" title={user?.name}>{firstName(user)}</p>
          <p className="profile-tier">
            {(user as any)?.offline ? 'On this device only' : <>Traveler <span>{user?.homeAirport ? `· ${user.homeAirport}` : ''}</span></>}
          </p>
        </div>
        <button
          type="button"
          className="profile-add"
          onClick={() => { navigate('/plan-trip'); onNavigate(); }}
          aria-label="Plan a new trip"
          title="Plan a new trip"
        >
          <Plus size={26} strokeWidth={1.5} />
        </button>
      </div>

      <SafetyCard onNavigate={onNavigate} />

      <nav className="side-nav" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `side-link ${isActive ? 'is-active' : ''}`}
            onClick={onNavigate}
          >
            <Icon size={22} strokeWidth={1.5} />
            <span>{label}</span>
            {to === '/emergency-support' && <span className="side-link-badge">24/7</span>}
          </NavLink>
        ))}
      </nav>

      <div className="side-explore">
        <p className="eyebrow">Explore destinations</p>
        <ul>
          {groups.map(g => {
            const count = DESTINATIONS.filter(d => d.region === g.id).length;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  className={`side-group ${activeRegion === g.id ? 'is-active' : ''}`}
                  onClick={() => { navigate(`/?region=${g.id}#explore`); onNavigate(); }}
                >
                  <span className="side-group-swatch" style={{ borderColor: g.swatch }} aria-hidden="true" />
                  <span className="side-group-label">{g.label}</span>
                  <span className="side-group-count">+{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="side-more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
          <ChevronDown size={18} className={showAll ? 'is-open' : ''} />
          {showAll ? 'Show less' : 'Show more'}
        </button>
      </div>

      <button type="button" className="side-signout" onClick={onSignOut}>
        <LogOut size={18} strokeWidth={1.75} />
        Sign out
      </button>
    </div>
  );
};

/* --------------------------------------------------------------------------
   Shell
   -------------------------------------------------------------------------- */
const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer and reset scroll on every route change
  useEffect(() => {
    setDrawerOpen(false);
    if (!location.hash) window.scrollTo({ top: 0 });
  }, [location.pathname, location.hash]);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  // Sync profile + journeys from the server once per session load
  useEffect(() => {
    ensureSession().then(ok => { if (!ok) return;
    api<{ profile: { full_name: string | null; home_airport: string | null; home_city: string | null; role: string } }>('/profile')
      .then(({ profile }) => {
        const cur = getUser();
        if (!cur) return;
        localStorage.setItem('user', JSON.stringify({
          ...cur,
          name: profile.full_name || cur.name,
          homeAirport: profile.home_airport || undefined,
          homeCity: profile.home_city || undefined,
          role: profile.role,
          offline: false,
        }));
        window.dispatchEvent(new Event('auth-change'));
      })
      .catch(() => undefined);
    refreshJourneys().catch(() => undefined);
    });
  }, []);

  const signOut = () => {
    setSession(null);
    clearJourneyCache();
    localStorage.removeItem('user');
    window.dispatchEvent(new Event('auth-change'));
    navigate('/login');
  };

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Sidebar">
        <Sidebar user={user} onNavigate={() => undefined} onSignOut={signOut} />
      </aside>

      {/* Mobile top bar */}
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
          <Menu size={22} />
        </button>
        <NavLink to="/" className="topbar-brand">TravelSphere</NavLink>
        <button type="button" className="topbar-avatar" onClick={() => navigate('/?profile=edit')} aria-label="Edit profile">
          {initials(user?.name)}
          {!isProfileComplete(user) && <span className="profile-dot" />}
        </button>
      </header>

      {/* Mobile drawer */}
      <div className={`drawer-scrim ${drawerOpen ? 'is-open' : ''}`} onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      <aside className={`drawer ${drawerOpen ? 'is-open' : ''}`} aria-label="Menu" aria-hidden={!drawerOpen}>
        <button type="button" className="icon-btn drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
          <X size={22} />
        </button>
        <Sidebar user={user} onNavigate={() => setDrawerOpen(false)} onSignOut={signOut} />
      </aside>

      <main className="shell-main" id="main">{children}</main>

      {/* Mobile tab bar */}
      <nav className="tabbar" aria-label="Primary">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}>
            <Icon size={22} strokeWidth={1.6} />
            <span>{label === 'Plan a trip' ? 'Plan' : label === 'My trips' ? 'Trips' : label === 'Emergency' ? 'SOS' : label}</span>
          </NavLink>
        ))}
      </nav>

    </div>
  );
};

export default AppShell;
