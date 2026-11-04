// My trips — trip strip, selected trip hero, day-by-day itinerary and deals
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CalendarDays, Users, Wallet, MapPin, Bookmark, BookmarkCheck,
  Plus, Star, Check, ArrowUpRight, BedDouble, XCircle, RotateCcw, Cloud, HardDrive,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Segmented from '@/components/ui/Segmented';
import Photo from '@/components/ui/Photo';
import TripCard from '@/components/ui/TripCard';
import ItineraryTimeline from '../components/itinerary/ItineraryTimeline';
import BookingModal, { BookingData } from '../components/booking/BookingModal';
import { generateMockItinerary } from '../services/mockDataService';
import { getDestination, DESTINATIONS, HOTEL_IMAGES } from '@/data/destinations';
import {
  getStoredItinerary, getTrips, getUser, isTripSaved, tripFromStored, fmtLong, nightsBetween,
  updateStoredItinerary, cacheItinerary,
} from '@/services/tripStore';
import { getSession, ApiError } from '@/services/apiClient';
import {
  fetchJourney, fromServerJourney, saveJourney, setJourneyStatus, TRIPS_EVENT,
} from '@/services/journeySync';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import type { ItineraryDay } from '@/types/itinerary';
import './ItineraryPage.css';

const SAMPLE_IDS = ['kyoto', 'santorini', 'bali'] as const;
const SAMPLE_LENGTH: Record<string, number> = { kyoto: 5, santorini: 4, bali: 6 };

type Tab = 'itinerary' | 'deals';

const ItineraryPage: React.FC = () => {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const [version, setVersion] = useState(0); // bump to re-read storage
  const [tab, setTab] = useState<Tab>('itinerary');
  const [bookingFor, setBookingFor] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  // A specific trip id never falls back to a different trip
  const raw = useMemo(() => (tripId ? getStoredItinerary(tripId) : getStoredItinerary()), [tripId, version]);
  const [remote, setRemote] = useState<'idle' | 'loading' | 'missing'>('idle');
  const [busy, setBusy] = useState(false);
  const trip = raw ? tripFromStored(raw) : null;
  const allTrips = useMemo(() => getTrips().filter(t => t.kind === 'itinerary'), [version]);
  const user = getUser();

  const itinerary: ItineraryDay[] | null = useMemo(() => {
    if (!raw?.itinerary?.length) return null;
    return raw.itinerary.map((d: any) => ({ ...d, date: new Date(d.date) }));
  }, [raw]);

  const synced = !!raw?.journeyId;
  const saved = synced || isTripSaved(raw?.tripId);
  const cancelled = raw?.status === 'cancelled';
  const dest = trip?.destination;

  // Re-read when trips change elsewhere (server sync, planner)
  useEffect(() => {
    const bump = () => setVersion(v => v + 1);
    window.addEventListener(TRIPS_EVENT, bump);
    return () => window.removeEventListener(TRIPS_EVENT, bump);
  }, []);

  // A journey that lives on the server but isn't cached on this device
  useEffect(() => {
    if (!tripId || raw) { setRemote('idle'); return; }
    if (!getSession()) { setRemote('missing'); return; }
    let alive = true;
    setRemote('loading');
    fetchJourney(tripId)
      .then(j => {
        if (!alive) return;
        cacheItinerary(fromServerJourney(j) as any);
        setVersion(v => v + 1);
        setRemote('idle');
      })
      .catch(() => alive && setRemote('missing'));
    return () => { alive = false; };
  }, [tripId, raw]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSaveTrip = async () => {
    if (!raw || saved) return;
    if (getSession()) {
      setBusy(true);
      try {
        const id = await saveJourney(raw);
        if (id) {
          updateStoredItinerary(raw.tripId!, { journeyId: id });
          setToast('Trip saved to your account');
          navigate(`/itinerary/${id}`, { replace: true });
        }
      } catch (err) {
        setToast(err instanceof ApiError ? err.message : 'Could not save the trip');
      } finally {
        setBusy(false);
      }
      return;
    }
    const list = JSON.parse(localStorage.getItem('savedTrips') || '[]');
    list.push({ ...raw, savedAt: new Date().toISOString() });
    localStorage.setItem('savedTrips', JSON.stringify(list));
    setVersion(v => v + 1);
    setToast('Trip saved on this device');
  };

  const handleSetStatus = async (status: 'cancelled' | 'planned') => {
    if (!raw) return;
    if (status === 'cancelled' && !window.confirm(`Cancel your trip to ${trip?.title}? You can restore it later.`)) return;
    setBusy(true);
    try {
      if (raw.journeyId && getSession()) await setJourneyStatus(raw.journeyId, status);
      updateStoredItinerary(raw.journeyId || raw.tripId!, { status });
      setVersion(v => v + 1);
      setToast(status === 'cancelled' ? 'Trip cancelled' : 'Trip restored');
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : 'Could not update the trip');
    } finally {
      setBusy(false);
    }
  };

  const handleLoadSample = (id: string) => {
    const days = SAMPLE_LENGTH[id] || 4;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + 21);
    const end = new Date(start);
    end.setDate(end.getDate() + days - 1); // inclusive: a 5-day sample spans 4 nights
    const d = getDestination(id)!;
    const result = generateMockItinerary({
      destination: id,
      startDate: start,
      endDate: end,
      budget: 'medium',
      interests: d.category.filter(c => ['food', 'culture', 'nature', 'adventure', 'shopping'].includes(c)) as any,
    });
    if (result.success && result.data) {
      const stored = { ...result.data, destination: id, startDate: start, endDate: end, budget: 'medium', travelers: 2 };
      sessionStorage.setItem('generatedItinerary', JSON.stringify(stored));
      localStorage.setItem('currentTrip', JSON.stringify(stored));
      navigate(`/itinerary/${result.data.tripId}`);
      setVersion(v => v + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleConfirmBooking = (bookingData: BookingData) => {
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    bookings.push({ ...bookingData, bookingId: `booking-${Date.now()}`, bookedAt: new Date().toISOString() });
    localStorage.setItem('bookings', JSON.stringify(bookings));
    setBookingFor(null);
    setToast('Booking confirmed — you’ll find it on your dashboard');
  };

  const city = dest?.city || 'your destination';
  const offers = [
    { id: 1, title: `Boutique stay in ${city}`, image: HOTEL_IMAGES[0], was: 450, now: 299, rating: 4.8, reviews: 1234, features: ['Breakfast included', 'Airport transfer', 'Spa access'] },
    { id: 2, title: `${city} landmarks, guided`, image: dest?.imageUrl || HOTEL_IMAGES[1], caption: dest?.imageCaption, was: 180, now: 129, rating: 4.9, reviews: 856, features: ['Skip-the-line entry', 'Local guide', 'Small group'] },
    { id: 3, title: 'Resort pool & spa day', image: HOTEL_IMAGES[3], was: 220, now: 149, rating: 4.7, reviews: 2103, features: ['Day bed', 'Lunch', 'Massage'] },
    { id: 4, title: 'Design hotel, city centre', image: HOTEL_IMAGES[1], was: 280, now: 199, rating: 4.6, reviews: 1567, features: ['Free cancellation', 'Rooftop bar', 'Gym'] },
  ];

  if (remote === 'loading') {
    return (
      <div className="page">
        <LoadingSpinner size="lg" message="Loading your trip…" />
      </div>
    );
  }

  if (tripId && remote === 'missing' && !raw) {
    return (
      <div className="page">
        <PageHeader title="My trips" />
        <div className="surface empty-state">
          <div className="empty-state-icon"><MapPin size={26} strokeWidth={1.6} /></div>
          <h3>Trip not found</h3>
          <p>This trip doesn’t exist, was removed, or belongs to another account.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/itinerary')} style={{ marginTop: 'var(--space-3)' }}>
            Back to my trips
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- empty */
  if (!itinerary || !trip) {
    return (
      <div className="page">
        <PageHeader
          title="My trips"
          subtitle="Your itineraries, bookings and saved plans live here."
          actions={<button type="button" className="btn btn-primary" onClick={() => navigate('/plan-trip')}><Plus size={16} /> New trip</button>}
        />
        <div className="surface empty-state">
          <div className="empty-state-icon"><MapPin size={26} strokeWidth={1.6} /></div>
          <h3>No itinerary yet</h3>
          <p>Plan a trip to get a day-by-day itinerary, or open one of these sample trips to see how it works.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/plan-trip')} style={{ marginTop: 'var(--space-3)' }}>
            <Plus size={16} /> Plan a trip
          </button>
        </div>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Sample itineraries</h2>
          </div>
          <div className="card-grid">
            {SAMPLE_IDS.map(id => {
              const d = DESTINATIONS.find(x => x.id === id)!;
              return (
                <article key={id} className="tcard pcard">
                  <Photo src={d.imageUrl} alt={`${d.imageCaption}, ${d.city}`} width={360} ratio="4 / 3" caption={d.imageCaption} className="tcard-photo" />
                  <div className="tcard-body">
                    <div className="tcard-title-row">
                      <h3 className="tcard-title">{d.city}</h3>
                      <span className="tcard-provider">{SAMPLE_LENGTH[id]} days</span>
                    </div>
                    <p className="pcard-desc">{d.description}</p>
                  </div>
                  <footer className="pcard-foot">
                    <span className="pcard-price">{d.highlights.slice(0, 2).join(' · ')}</span>
                    <button type="button" className="btn btn-soft btn-sm" onClick={() => handleLoadSample(id)}>
                      Open <ArrowUpRight size={16} />
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  /* --------------------------------------------------------------- active */
  const nights = nightsBetween(trip.startDate, trip.endDate);
  const cost = raw?.estimatedCost;

  return (
    <div className="page trips">
      <PageHeader
        title="My trips"
        subtitle={
          <span className="sync-state">
            {synced ? <Cloud size={15} /> : <HardDrive size={15} />}
            {synced ? 'Saved to your account' : getSession() ? 'Not saved to your account yet' : 'Saved on this device only'}
            {allTrips.length > 1 ? ` · ${allTrips.length} trips` : ''}
          </span>
        }
        actions={
          <button type="button" className="btn btn-primary" onClick={() => navigate('/plan-trip')}><Plus size={16} /> New trip</button>
        }
      />

      {allTrips.length > 1 && (
        <div className="scroller trips-strip">
          {allTrips.map(t => (
            <TripCard
              key={t.id}
              trip={t}
              origin={user?.homeAirport}
              selected={t.id === raw?.tripId}
              onSelect={() => navigate(`/itinerary/${t.id}`)}
              onOpen={() => navigate(`/itinerary/${t.id}`)}
            />
          ))}
        </div>
      )}

      {/* Hero */}
      <section className="surface trip-hero fade-up" key={trip.id}>
        <Photo
          src={trip.image}
          alt={trip.imageCaption ? `${trip.imageCaption}, ${trip.title}` : trip.title}
          width={520}
          ratio="4 / 3"
          caption={trip.imageCaption}
          priority
          className="trip-hero-photo"
        />
        <div className="trip-hero-body">
          <p className="eyebrow">
            {dest?.country || 'Itinerary'}
            {cancelled && <span className="tag tag-danger trip-status-tag">Cancelled</span>}
          </p>
          <h2 className="trip-hero-title">{trip.title}</h2>
          {dest && <p className="trip-hero-desc">{dest.description}</p>}

          <dl className="trip-hero-facts">
            <div><dt><CalendarDays size={16} /> Dates</dt><dd>{fmtLong(trip.startDate)} – {fmtLong(trip.endDate)}</dd></div>
            <div><dt><MapPin size={16} /> Length</dt><dd>{itinerary.length} days{nights ? ` · ${nights} nights` : ''}</dd></div>
            <div><dt><Users size={16} /> Travellers</dt><dd>{trip.travelers}</dd></div>
            {cost && <div><dt><Wallet size={16} /> Estimate</dt><dd>${Math.round(cost.min).toLocaleString()} – ${Math.round(cost.max).toLocaleString()}</dd></div>}
          </dl>

          <div className="trip-hero-actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/book-hotels${dest ? `?location=${encodeURIComponent(dest.city)}` : ''}`)}>
              <BedDouble size={16} /> Find hotels
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleSaveTrip} disabled={saved || busy}>
              {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />} {saved ? 'Saved' : 'Save trip'}
            </button>
            {cancelled ? (
              <button type="button" className="btn btn-ghost" onClick={() => handleSetStatus('planned')} disabled={busy}>
                <RotateCcw size={16} /> Restore trip
              </button>
            ) : (
              <button type="button" className="btn btn-ghost trip-cancel" onClick={() => handleSetStatus('cancelled')} disabled={busy}>
                <XCircle size={16} /> Cancel trip
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="trips-tabs">
        <Segmented<Tab>
          ariaLabel="Trip sections"
          value={tab}
          onChange={setTab}
          options={[{ value: 'itinerary', label: 'Itinerary' }, { value: 'deals', label: 'Deals' }]}
        />
      </div>

      {tab === 'itinerary' ? (
        <div className="itinerary-layout">
          <nav className="day-nav" aria-label="Jump to day">
            {itinerary.map(d => (
              <a key={d.dayNumber} href={`#day-${d.dayNumber}`} onClick={e => {
                e.preventDefault();
                document.getElementById(`day-${d.dayNumber}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}>
                <span>Day {d.dayNumber}</span>
                <span className="text-muted">{d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </a>
            ))}
          </nav>
          <ItineraryTimeline itinerary={itinerary} />
        </div>
      ) : (
        <div className="card-grid">
          {offers.map(o => (
            <article key={o.id} className="tcard pcard">
              <Photo src={o.image} alt={o.title} width={360} ratio="4 / 3" caption={(o as any).caption} className="tcard-photo">
                <span className="deal-badge">−{Math.round((1 - o.now / o.was) * 100)}%</span>
              </Photo>
              <div className="tcard-body">
                <h3 className="deal-title">{o.title}</h3>
                <p className="deal-rating"><Star size={14} /> {o.rating} <span>({o.reviews.toLocaleString()} reviews)</span></p>
                <ul className="deal-features">
                  {o.features.map(f => <li key={f}><Check size={14} /> {f}</li>)}
                </ul>
              </div>
              <footer className="pcard-foot">
                <span className="pcard-price"><s>${o.was}</s> <strong>${o.now}</strong></span>
                <button type="button" className="btn btn-soft btn-sm" onClick={() => setBookingFor(`${o.title}${dest ? `, ${dest.city}` : ''}`)}>
                  Book
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {bookingFor && (
        <BookingModal destination={bookingFor} onClose={() => setBookingFor(null)} onBook={handleConfirmBooking} />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
};

export default ItineraryPage;
