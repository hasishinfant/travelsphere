// Bridges locally generated itineraries and server journeys (/api/journeys).
// localStorage stays the offline cache; the server is the record of truth when signed in.
import { api, getSession } from './apiClient';
import { getDestination } from '@/data/destinations';

export interface ServerItem {
  id: string;
  day_number: number;
  position: number;
  title: string;
  description: string | null;
  category: string | null;
  activity_type: string;
  latitude: number | null;
  longitude: number | null;
  planned_duration_minutes: number | null;
}

export interface ServerJourney {
  id: string;
  title: string | null;
  destination_id: string;
  destination_name: string;
  latitude: number | null;
  longitude: number | null;
  start_date: string;
  end_date: string;
  travellers: number;
  budget: 'low' | 'medium' | 'luxury' | null;
  interests: string[];
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  item_count?: number;
  items?: ServerItem[];
}

const CACHE_KEY = 'journeysCache';
export const TRIPS_EVENT = 'trips-updated';
const notify = () => window.dispatchEvent(new Event(TRIPS_EVENT));

export const getCachedJourneys = (): ServerJourney[] => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
  } catch {
    return [];
  }
};

const ACTIVITY: Record<string, string> = {
  nature: 'sightseeing', culture: 'sightseeing', art: 'indoor', food: 'dining', shopping: 'shopping',
  beach: 'water', relaxation: 'sightseeing', adventure: 'trekking', urban: 'sightseeing',
  entertainment: 'indoor', technology: 'indoor', romance: 'sightseeing',
};

/** "2–3 hours" → 150, "45 min" → 45, "Full day" → 480 */
export const parseDuration = (s?: string): number | null => {
  if (!s) return null;
  if (/full day/i.test(s)) return 480;
  const nums = (s.match(/\d+(\.\d+)?/g) || []).map(Number);
  if (!nums.length) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(/min/i.test(s) && !/hour/i.test(s) ? avg : avg * 60);
};

export const formatDuration = (m: number | null | undefined) => {
  if (!m) return '';
  if (m >= 480) return 'Full day';
  if (m < 60) return `${m} min`;
  const h = m / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`;
};

const ymd = (d: Date | string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Convert a stored planner itinerary into the POST /api/journeys payload. */
export const toJourneyPayload = (stored: any) => {
  const dest = getDestination(stored.destination);
  return {
    destination_id: dest?.id || String(stored.destination || 'custom').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40),
    destination_name: dest?.name || String(stored.destination || 'Custom destination'),
    latitude: dest?.coordinates[0] ?? null,
    longitude: dest?.coordinates[1] ?? null,
    start_date: ymd(stored.startDate || stored.itinerary[0].date),
    end_date: ymd(stored.endDate || stored.itinerary[stored.itinerary.length - 1].date),
    travellers: Math.min(20, Math.max(1, Number(stored.travelers) || 1)),
    budget: stored.budget || null,
    interests: (stored.interests || []).filter((i: string) => ['food', 'adventure', 'culture', 'nature', 'shopping'].includes(i)),
    items: (stored.itinerary as any[]).flatMap((day, d) =>
      (day.places || []).map((p: any, i: number) => ({
        day_number: Math.min(60, (day.dayNumber as number) || d + 1),
        position: i,
        title: String(p.name).slice(0, 160),
        description: p.description ? String(p.description).slice(0, 1000) : null,
        category: p.category ? String(p.category).slice(0, 40) : null,
        activity_type: ACTIVITY[p.category] || 'other',
        planned_duration_minutes: parseDuration(p.estimatedTime),
      })),
    ).slice(0, 300),
  };
};

/** Rebuild the itinerary shape the UI renders from a server journey (e.g. opened on another device). */
export const fromServerJourney = (j: ServerJourney) => {
  const dest = getDestination(j.destination_id);
  const start = new Date(`${j.start_date}T00:00:00`);
  const days = Math.max(1, ...(j.items || []).map(i => i.day_number));
  return {
    tripId: j.id,
    journeyId: j.id,
    status: j.status,
    destination: j.destination_id,
    startDate: start,
    endDate: new Date(`${j.end_date}T00:00:00`),
    travelers: j.travellers,
    budget: j.budget,
    interests: j.interests,
    itinerary: Array.from({ length: days }, (_, k) => {
      const date = new Date(start);
      date.setDate(date.getDate() + k);
      return {
        dayNumber: k + 1,
        date,
        places: (j.items || []).filter(i => i.day_number === k + 1).map(i => ({
          name: i.title,
          description: i.description || '',
          estimatedTime: formatDuration(i.planned_duration_minutes),
          category: i.category || 'other',
        })),
        foodRecommendations: dest ? dest.food[(j.budget || 'medium') as 'low' | 'medium' | 'luxury'] : [],
        travelTips: dest ? [dest.tips[k % dest.tips.length]] : [],
      };
    }),
  };
};

/** Save a freshly planned itinerary to the server. Returns the journey id, or null when offline. */
export async function saveJourney(stored: any): Promise<string | null> {
  if (!getSession()) return null;
  const { journey } = await api<{ journey: ServerJourney }>('/journeys', { method: 'POST', body: toJourneyPayload(stored) });
  await refreshJourneys();
  return journey.id;
}

export async function refreshJourneys(): Promise<ServerJourney[]> {
  if (!getSession()) return [];
  const { journeys } = await api<{ journeys: ServerJourney[] }>('/journeys');
  localStorage.setItem(CACHE_KEY, JSON.stringify(journeys));
  notify();
  return journeys;
}

export async function fetchJourney(id: string): Promise<ServerJourney> {
  const { journey } = await api<{ journey: ServerJourney }>(`/journeys/${id}`);
  return journey;
}

export async function setJourneyStatus(id: string, status: ServerJourney['status']) {
  await api(`/journeys/${id}`, { method: 'PUT', body: { status } });
  await refreshJourneys();
}

export const clearJourneyCache = () => {
  localStorage.removeItem(CACHE_KEY);
  notify();
};
