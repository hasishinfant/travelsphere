import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Pencil, Plane, PlaneLanding, PlaneTakeoff, Compass, BedDouble, LifeBuoy,
  CalendarDays, Wallet, Star, Clock, ArrowUpRight, ChevronLeft, ChevronRight, Plus,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Segmented from '@/components/ui/Segmented';
import TripCard from '@/components/ui/TripCard';
import PlaceCard from '@/components/ui/PlaceCard';
import Photo from '@/components/ui/Photo';
import MapModal from '@/components/ui/MapModal';
import ProfileModal from '@/components/ui/ProfileModal';
import { DESTINATIONS, DESTINATION_GROUPS, EXPERIENCES, type DestinationRecord } from '@/data/destinations';
import { TRIPS_EVENT } from '@/services/journeySync';
import { useConditions } from '@/services/conditions';
import {
  getUser, getTrips, splitTrips, firstName, greeting, isProfileComplete, initials,
  fmtDay, fmtWeekday, nightsBetween, daysUntil, type Trip,
} from '@/services/tripStore';
import './HomePage.css';

type Range = 'upcoming' | 'recent';

const scrollRow = (id: string, dir: 1 | -1) => {
  const el = document.getElementById(id);
  el?.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: 'smooth' });
};

const TripDetails: React.FC<{ trip: Trip; origin?: string }> = ({ trip, origin }) => {
  const navigate = useNavigate();
  const d = trip.destination;
  const nights = nightsBetween(trip.startDate, trip.endDate);
  const until = daysUntil(trip.startDate);

  return (
    <div className="details-grid fade-up" key={trip.id}>
      <div className="surface details-dates">
        <div className="details-leg">
          <span className="details-leg-label">Leave <PlaneTakeoff size={16} /></span>
          <p className="details-leg-date">
            {fmtDay(trip.startDate)}<span>, {fmtWeekday(trip.startDate)}</span>
          </p>
          <p className="details-leg-sub">{until !== undefined && until >= 0 ? (until === 0 ? 'Today' : `in ${until} day${until === 1 ? '' : 's'}`) : 'Departed'}</p>
        </div>
        <div className="details-leg is-end">
          <span className="details-leg-label">Return <PlaneLanding size={16} /></span>
          <p className="details-leg-date">
            {fmtDay(trip.endDate)}<span>, {fmtWeekday(trip.endDate)}</span>
          </p>
          <p className="details-leg-sub">{nights ? `${nights} night${nights === 1 ? '' : 's'}` : '—'}</p>
        </div>
      </div>

      <div className="surface-flat details-route">
        <div>
          <p className="details-code">{origin || 'HOME'}</p>
          <p className="details-city">{origin ? getUser()?.homeCity || 'Home' : 'Set home airport'}</p>
        </div>
        <div className="details-path" aria-hidden="true">
          <span className="details-dash" />
          <span className="details-plane"><Plane size={20} strokeWidth={1.75} /></span>
          <span className="details-dash" />
        </div>
        <div className="is-end">
          <p className="details-code">{trip.airport || '—'}</p>
          <p className="details-city">{trip.title}</p>
        </div>
      </div>

      {d && (
        <div className="surface-flat details-facts">
          <div className="details-fact">
            <CalendarDays size={18} />
            <div><p className="eyebrow">Best time</p><p>{d.bestTimeToVisit}</p></div>
          </div>
          <div className="details-fact">
            <Wallet size={18} />
            <div><p className="eyebrow">Daily budget</p><p>${d.averageCost.low} – ${d.averageCost.luxury}</p></div>
          </div>
          <div className="details-fact">
            <Star size={18} />
            <div><p className="eyebrow">Highlights</p><p>{d.highlights.slice(0, 3).join(' · ')}</p></div>
          </div>
        </div>
      )}

      <div className="details-actions">
        <button type="button" className="btn btn-primary" onClick={() => navigate(trip.path)}>
          Open trip <ArrowUpRight size={16} />
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => navigate(`/book-hotels${d ? `?location=${encodeURIComponent(d.city)}` : ''}`)}>
          <BedDouble size={16} /> Find hotels
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/emergency-support')}>
          <LifeBuoy size={16} /> Report an incident
        </button>
      </div>
    </div>
  );
};

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<Range>('upcoming');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapFor, setMapFor] = useState<DestinationRecord | null>(null);
  const [user, setUser] = useState(getUser);
  const [trips, setTrips] = useState(getTrips);
  const conditions = useConditions();

  useEffect(() => {
    const sync = () => { setUser(getUser()); setTrips(getTrips()); };
    window.addEventListener('auth-change', sync);
    window.addEventListener('storage', sync);
    window.addEventListener(TRIPS_EVENT, sync);
    return () => {
      window.removeEventListener('auth-change', sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener(TRIPS_EVENT, sync);
    };
  }, []);

  // Scroll to #explore when linked from the sidebar
  useEffect(() => {
    if (location.hash === '#explore') {
      requestAnimationFrame(() => document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, [location.hash, location.search]);

  const { upcoming, recent } = useMemo(() => splitTrips(trips), [trips]);
  const list = range === 'upcoming' ? upcoming : recent;
  const selected = list.find(t => t.id === selectedId) || list[0];

  const region = params.get('region') || 'all';
  const shownDestinations = region === 'all' ? DESTINATIONS : DESTINATIONS.filter(d => d.region === region);
  const setRegion = (r: string) => {
    const next = new URLSearchParams(params);
    if (r === 'all') next.delete('region'); else next.set('region', r);
    setParams(next, { replace: true });
  };

  const profileOpen = params.get('profile') === 'edit';
  const closeProfile = () => {
    const next = new URLSearchParams(params);
    next.delete('profile');
    setParams(next, { replace: true });
  };

  const planTrip = (id: string) => navigate(`/plan-trip?destination=${id}`);

  return (
    <div className="page home">
      <PageHeader
        title={`${greeting()}, ${firstName(user)}`}
        actions={
          <Segmented<Range>
            ariaLabel="Trips"
            value={range}
            onChange={r => { setRange(r); setSelectedId(null); }}
            options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'recent', label: 'Recent' }]}
          />
        }
      >
        {!isProfileComplete(user) ? (
          <div className="profile-prompt">
            <span className="profile-prompt-avatar">{initials(user?.name)}</span>
            <span className="text-muted">Please, finish your profile.</span>
            <button type="button" className="link-btn" onClick={() => setParams({ profile: 'edit' })}>
              Edit now <Pencil size={14} strokeWidth={2.25} />
            </button>
          </div>
        ) : (
          <p className="page-subtitle">
            {upcoming.length
              ? `You have ${upcoming.length} upcoming trip${upcoming.length === 1 ? '' : 's'}. Flying from ${user?.homeCity || user?.homeAirport}.`
              : 'Where to next? Pick a destination below to start planning.'}
          </p>
        )}
      </PageHeader>

      {/* Trips ----------------------------------------------------------- */}
      <section className="section" aria-labelledby="trips-title">
        <div className="section-head">
          <h2 className="section-title" id="trips-title">
            {range === 'upcoming' ? 'Upcoming' : 'Recent'}
            <span className="count-badge">{list.length}</span>
          </h2>
          {list.length > 2 && (
            <div className="row-nav">
              <button type="button" className="icon-btn is-outlined" onClick={() => scrollRow('trip-row', -1)} aria-label="Scroll trips left"><ChevronLeft size={18} /></button>
              <button type="button" className="icon-btn is-outlined" onClick={() => scrollRow('trip-row', 1)} aria-label="Scroll trips right"><ChevronRight size={18} /></button>
            </div>
          )}
        </div>

        {list.length ? (
          <div className="scroller" id="trip-row">
            {list.map((t, i) => (
              <TripCard
                key={t.id}
                trip={t}
                origin={user?.homeAirport}
                selected={selected?.id === t.id}
                onSelect={() => setSelectedId(t.id)}
                onOpen={() => navigate(t.path)}
                priority={i < 2}
              />
            ))}
            <button type="button" className="tcard tcard-new" onClick={() => navigate('/plan-trip')}>
              <span className="tcard-new-icon"><Plus size={22} strokeWidth={1.75} /></span>
              <span className="tcard-new-title">Plan another trip</span>
              <span className="text-muted">Day-by-day itinerary</span>
            </button>
          </div>
        ) : (
          <div className="surface empty-trips">
            <div className="empty-trips-copy">
              <div className="empty-state-icon"><Compass size={26} strokeWidth={1.6} /></div>
              <h3>{range === 'upcoming' ? 'No upcoming trips yet' : 'No past trips yet'}</h3>
              <p>
                {range === 'upcoming'
                  ? 'Plan a trip and it will appear here with dates, route and details.'
                  : 'Trips you’ve completed will show up here.'}
              </p>
              <div className="empty-trips-actions">
                <button type="button" className="btn btn-primary" onClick={() => navigate('/plan-trip')}>
                  <Plus size={16} /> Plan a trip
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth' })}>
                  <Compass size={16} /> Browse destinations
                </button>
              </div>
            </div>
            <div className="empty-trips-art" aria-hidden="true">
              {DESTINATIONS.slice(0, 3).map((d, i) => (
                <Photo key={d.id} src={d.imageUrl} alt="" width={200} ratio="3 / 4" className={`empty-trips-photo p${i}`} priority />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Details --------------------------------------------------------- */}
      {selected && (
        <section className="section" aria-labelledby="details-title">
          <div className="section-head">
            <h2 className="section-title" id="details-title">Details</h2>
          </div>
          <TripDetails trip={selected} origin={user?.homeAirport} />
        </section>
      )}

      {/* Explore --------------------------------------------------------- */}
      <section className="section" id="explore" aria-labelledby="explore-title">
        <div className="section-head section-head-wrap">
          <div>
            <h2 className="section-title" id="explore-title">
              Destinations <span className="count-badge">{shownDestinations.length}</span>
            </h2>
            <p className="section-sub">Live safety for each place from 8 factors. Open a place for the full breakdown and its 360° view.</p>
          </div>
          <div className="chip-row" role="tablist" aria-label="Filter by region">
            {[{ id: 'all', label: 'All' }, ...DESTINATION_GROUPS].map(g => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={region === g.id}
                className={`chip ${region === g.id ? 'is-active' : ''}`}
                onClick={() => setRegion(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-grid">
          {shownDestinations.map((d, i) => (
            <PlaceCard key={d.id} destination={d} onPlan={planTrip} onOpen={id => navigate(`/places/${id}`)} onMap={setMapFor} conditions={conditions} priority={!selected && i < 3} />
          ))}
        </div>
      </section>

      {/* Experiences ----------------------------------------------------- */}
      <section className="section" aria-labelledby="exp-title">
        <div className="section-head">
          <h2 className="section-title" id="exp-title">Experiences</h2>
          <div className="row-nav">
            <button type="button" className="icon-btn is-outlined" onClick={() => scrollRow('exp-row', -1)} aria-label="Scroll experiences left"><ChevronLeft size={18} /></button>
            <button type="button" className="icon-btn is-outlined" onClick={() => scrollRow('exp-row', 1)} aria-label="Scroll experiences right"><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="scroller" id="exp-row">
          {EXPERIENCES.map(x => (
            <article key={x.id} className="xcard">
              <Photo src={x.image} alt={`${x.title}, ${x.location}`} width={300} ratio="4 / 5" className="xcard-photo">
                <span className="img-caption xcard-tag">{x.tag}</span>
              </Photo>
              <div className="xcard-body">
                <h3>{x.title}</h3>
                <p className="text-muted">{x.location}</p>
                <div className="xcard-meta">
                  <span><Clock size={14} /> {x.duration}</span>
                  <span><Star size={14} /> {x.rating}</span>
                </div>
                <div className="xcard-foot">
                  <span className="pcard-price">from <strong>${x.price}</strong></span>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => planTrip(x.destinationId)}>
                    Add to trip
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {mapFor && <MapModal destination={mapFor} onClose={() => setMapFor(null)} />}
      {profileOpen && <ProfileModal onClose={closeProfile} />}
    </div>
  );
};

export default HomePage;
