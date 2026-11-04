// Place profiles used by the safety engine. Coordinates match the landmark shown in the app
// (src/data/destinations.ts). `setting` and `terrain` are CONFIGURED prototype classifications of the
// landmark's surroundings — editorial inputs, not measurements — and are reported as such.

export type Setting = 'urban' | 'island' | 'rural' | 'remote';
export type Terrain = 'cliffs' | 'coastal' | 'waterfall' | 'glacial-river' | 'volcanic';

export interface PlaceProfile {
  id: string;
  name: string;
  lat: number;
  lng: number;
  setting: Setting;
  terrain: Terrain[];
  /** Typical visit activity used when the traveller has no journey for this place. */
  defaultActivity: 'sightseeing' | 'trekking' | 'water' | 'indoor';
}

export const PLACES: PlaceProfile[] = [
  { id: 'paris', name: 'Paris, France', lat: 48.8584, lng: 2.2945, setting: 'urban', terrain: [], defaultActivity: 'sightseeing' },
  { id: 'london', name: 'London, UK', lat: 51.5055, lng: -0.0754, setting: 'urban', terrain: [], defaultActivity: 'sightseeing' },
  { id: 'rome', name: 'Rome, Italy', lat: 41.8902, lng: 12.4922, setting: 'urban', terrain: [], defaultActivity: 'sightseeing' },
  { id: 'santorini', name: 'Santorini, Greece', lat: 36.4618, lng: 25.3753, setting: 'island', terrain: ['cliffs', 'coastal', 'volcanic'], defaultActivity: 'sightseeing' },
  { id: 'tokyo', name: 'Tokyo, Japan', lat: 35.6595, lng: 139.7005, setting: 'urban', terrain: [], defaultActivity: 'sightseeing' },
  { id: 'kyoto', name: 'Kyoto, Japan', lat: 34.9986, lng: 135.785, setting: 'urban', terrain: [], defaultActivity: 'sightseeing' },
  { id: 'bali', name: 'Bali, Indonesia', lat: -8.2752, lng: 115.1668, setting: 'rural', terrain: ['coastal', 'volcanic'], defaultActivity: 'sightseeing' },
  { id: 'new-york', name: 'New York City, USA', lat: 40.758, lng: -73.9855, setting: 'urban', terrain: [], defaultActivity: 'sightseeing' },
  { id: 'iceland', name: 'Reykjavík, Iceland', lat: 63.6156, lng: -19.9886, setting: 'remote', terrain: ['waterfall', 'coastal', 'glacial-river'], defaultActivity: 'trekking' },
  { id: 'bengaluru', name: 'Bengaluru, India', lat: 12.9791, lng: 77.5913, setting: 'urban', terrain: [], defaultActivity: 'sightseeing' },
];

export const getPlace = (id: string) => PLACES.find(p => p.id === id);
