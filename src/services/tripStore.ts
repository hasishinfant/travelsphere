// tripStore — reads everything the user has planned or booked from local storage
// and normalises it into one Trip shape for the dashboard and My Trips.
import { getDestination, HOTEL_IMAGES, type DestinationRecord } from '@/data/destinations';
import { getCachedJourneys } from './journeySync';

export type TripKind = 'itinerary' | 'hotel' | 'package';

export interface Trip {
  id: string;
  kind: TripKind;
  title: string;            // city or hotel name
  subtitle: string;         // "France" / "Hotel stay"
  destination?: DestinationRecord;
  airport?: string;
  image: string;
  imageCaption?: string;
  startDate?: Date;
  endDate?: Date;
  travelers: number;
  days?: number;
  provider?: string;        // "Itinerary", hotel name, room type
  path: string;             // where "Details" navigates
  status?: 'planned' | 'active' | 'completed' | 'cancelled';
  synced?: boolean;         // stored on the server
}

export interface UserProfile {
  name: string;
  email: string;
  homeAirport?: string;
  homeCity?: string;
  tier?: string;
}

const read = <T,>(key: string, fallback: T, store: Storage = localStorage): T => {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toDate = (v: unknown): Date | undefined => {
  if (!v) return undefined;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export const getUser = (): UserProfile | null => read<UserProfile | null>('user', null);

export const updateUser = (patch: Partial<UserProfile>) => {
  const current = getUser();
  if (!current) return;
  localStorage.setItem('user', JSON.stringify({ ...current, ...patch }));
  window.dispatchEvent(new Event('auth-change'));
};

export const firstName = (u: UserProfile | null) => (u?.name || 'Traveler').split(' ')[0];

export const isProfileComplete = (u: UserProfile | null) => Boolean(u?.name && u?.homeAirport);

export const greeting = (date = new Date()) => {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

/** Itinerary JSON as stored by the planner (ItineraryResponse + planner meta). */
interface StoredItinerary {
  tripId?: string;
  journeyId?: string;
  status?: Trip['status'];
  destination?: string;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  itinerary?: Array<{ date?: string }>;
  savedAt?: string;
}

const fromItinerary = (raw: StoredItinerary, fallbackId: string): Trip | null => {
  if (!raw?.itinerary?.length) return null;
  const dest = getDestination(raw.destination);
  const start = toDate(raw.startDate) || toDate(raw.itinerary[0]?.date);
  const end = toDate(raw.endDate) || toDate(raw.itinerary[raw.itinerary.length - 1]?.date);
  const id = raw.journeyId || raw.tripId || fallbackId;
  return {
    id,
    kind: 'itinerary',
    title: dest?.city || 'Custom trip',
    subtitle: dest?.country || 'Itinerary',
    destination: dest,
    airport: dest?.airport,
    image: dest?.imageUrl || HOTEL_IMAGES[0],
    imageCaption: dest?.imageCaption,
    startDate: start,
    endDate: end,
    travelers: raw.travelers || 1,
    days: raw.itinerary.length,
    provider: raw.status === 'cancelled' ? 'Cancelled' : 'Itinerary',
    path: `/itinerary/${id}`,
    status: raw.status,
    synced: !!raw.journeyId,
  };
};

export const getTrips = (): Trip[] => {
  const trips: Trip[] = [];

  const current = read<StoredItinerary | null>('currentTrip', null);
  const generated = read<StoredItinerary | null>('generatedItinerary', null, sessionStorage);
  const saved = read<StoredItinerary[]>('savedTrips', []);
  [generated, current, ...saved].forEach((raw, i) => {
    const t = raw && fromItinerary(raw, `itinerary-${i}`);
    if (t) trips.push(t);
  });

  // Journeys stored on the server but not cached on this device
  getCachedJourneys().forEach(j => {
    const dest = getDestination(j.destination_id);
    trips.push({
      id: j.id,
      kind: 'itinerary',
      title: dest?.city || j.destination_name,
      subtitle: dest?.country || 'Journey',
      destination: dest,
      airport: dest?.airport,
      image: dest?.imageUrl || HOTEL_IMAGES[0],
      imageCaption: dest?.imageCaption,
      startDate: toDate(`${j.start_date}T00:00:00`),
      endDate: toDate(`${j.end_date}T00:00:00`),
      travelers: j.travellers,
      days: Math.round((Date.parse(j.end_date) - Date.parse(j.start_date)) / 86400000) + 1,
      provider: j.status === 'cancelled' ? 'Cancelled' : 'Itinerary',
      path: `/itinerary/${j.id}`,
      status: j.status,
      synced: true,
    });
  });

  // Packages booked from My Trips → Deals
  read<Array<{ destination: string; checkIn: string; checkOut: string; guests: number; roomType: string; bookingId?: string }>>('bookings', [])
    .forEach((b, i) => {
      const dest = getDestination(b.destination);
      trips.push({
        id: b.bookingId || `package-${i}`,
        kind: 'package',
        title: dest?.city || b.destination,
        subtitle: dest?.country || 'Package',
        destination: dest,
        airport: dest?.airport,
        image: dest?.imageUrl || HOTEL_IMAGES[i % HOTEL_IMAGES.length],
        imageCaption: dest?.imageCaption,
        startDate: toDate(b.checkIn),
        endDate: toDate(b.checkOut),
        travelers: b.guests || 1,
        provider: `${b.roomType?.[0]?.toUpperCase() ?? ''}${b.roomType?.slice(1) ?? ''} room`,
        path: '/itinerary',
      });
    });

  // Hotel bookings from the hotel flow (API shape varies in casing)
  read<Array<Record<string, any>>>('hotel_bookings', []).forEach((b, i) => {
    const hotel = b.hotel || {};
    const city = hotel.cityName || hotel.CityName || '';
    const dest = getDestination(city);
    trips.push({
      id: b.confirmationNumber || `hotel-${i}`,
      kind: 'hotel',
      title: hotel.hotelName || hotel.HotelName || 'Hotel stay',
      subtitle: city || 'Hotel',
      destination: dest,
      airport: dest?.airport,
      image: dest?.imageUrl || HOTEL_IMAGES[i % HOTEL_IMAGES.length],
      imageCaption: dest?.imageCaption,
      startDate: toDate(b.checkIn),
      endDate: toDate(b.checkOut),
      travelers: (b.guestDetails || []).reduce((n: number, r: any) => n + (r.customerNames?.length || 0), 0) || 1,
      provider: 'Hotel booking',
      path: '/book-hotels',
    });
  });

  // De-duplicate (the same itinerary can be in session, current and saved)
  const seen = new Set<string>();
  return trips.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)));
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const splitTrips = (trips: Trip[]) => {
  const today = startOfToday();
  const upcoming = trips
    .filter(t => t.status !== 'cancelled' && (!t.endDate || t.endDate >= today))
    .sort((a, b) => (a.startDate?.getTime() ?? Infinity) - (b.startDate?.getTime() ?? Infinity));
  const recent = trips
    .filter(t => t.status !== 'cancelled' && t.endDate && t.endDate < today)
    .sort((a, b) => (b.endDate!.getTime()) - (a.endDate!.getTime()));
  return { upcoming, recent };
};

// ---------------------------------------------------------------------------
// Formatting helpers shared by trip cards and detail panels
// ---------------------------------------------------------------------------
export const fmtDay = (d?: Date) =>
  d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase() : '—';
export const fmtWeekday = (d?: Date) =>
  d ? d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase() : '';
export const fmtLong = (d?: Date) =>
  d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const nightsBetween = (a?: Date, b?: Date) =>
  a && b ? Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000)) : 0;
export const daysUntil = (d?: Date) =>
  d ? Math.ceil((d.getTime() - startOfToday().getTime()) / 86400000) : undefined;

export const initials = (name?: string) =>
  (name || 'T')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]!.toUpperCase())
    .join('');

/** Common home airports for the profile picker. */
export const HOME_AIRPORTS = [
  { code: 'BLR', city: 'Bengaluru' },
  { code: 'BOM', city: 'Mumbai' },
  { code: 'DEL', city: 'New Delhi' },
  { code: 'MAA', city: 'Chennai' },
  { code: 'HYD', city: 'Hyderabad' },
  { code: 'DXB', city: 'Dubai' },
  { code: 'SIN', city: 'Singapore' },
  { code: 'LHR', city: 'London' },
  { code: 'CDG', city: 'Paris' },
  { code: 'FRA', city: 'Frankfurt' },
  { code: 'JFK', city: 'New York' },
  { code: 'LAX', city: 'Los Angeles' },
  { code: 'YVR', city: 'Vancouver' },
  { code: 'SYD', city: 'Sydney' },
  { code: 'HND', city: 'Tokyo' },
];

/** Full stored itinerary (days, cost, planner meta) by trip id — or the current trip. */
export const getStoredItinerary = (tripId?: string): (StoredItinerary & Record<string, any>) | null => {
  const candidates = [
    read<StoredItinerary | null>('generatedItinerary', null, sessionStorage),
    read<StoredItinerary | null>('currentTrip', null),
    ...read<StoredItinerary[]>('savedTrips', []),
  ].filter((t): t is StoredItinerary => !!t?.itinerary?.length);
  if (tripId) return candidates.find(t => t.journeyId === tripId || t.tripId === tripId) || null;
  return candidates[0] || null;
};

export const isTripSaved = (tripId?: string) =>
  !!tripId && read<StoredItinerary[]>('savedTrips', []).some(t => t.tripId === tripId || t.journeyId === tripId);

/** Apply a change to every local copy of an itinerary (session, current and saved). */
export const updateStoredItinerary = (tripId: string, patch: Partial<StoredItinerary> & Record<string, unknown>) => {
  const match = (t: StoredItinerary | null) => !!t && (t.tripId === tripId || t.journeyId === tripId);
  const gen = read<StoredItinerary | null>('generatedItinerary', null, sessionStorage);
  if (match(gen)) sessionStorage.setItem('generatedItinerary', JSON.stringify({ ...gen, ...patch }));
  const cur = read<StoredItinerary | null>('currentTrip', null);
  if (match(cur)) localStorage.setItem('currentTrip', JSON.stringify({ ...cur, ...patch }));
  const saved = read<StoredItinerary[]>('savedTrips', []);
  if (saved.some(match)) localStorage.setItem('savedTrips', JSON.stringify(saved.map(t => (match(t) ? { ...t, ...patch } : t))));
};

/** Cache a server journey locally so it can be rendered (e.g. opened on a new device). */
export const cacheItinerary = (raw: StoredItinerary & Record<string, unknown>) => {
  sessionStorage.setItem('generatedItinerary', JSON.stringify(raw));
  localStorage.setItem('currentTrip', JSON.stringify(raw));
};

export const tripFromStored = (raw: StoredItinerary) => fromItinerary(raw, raw.tripId || 'current');
