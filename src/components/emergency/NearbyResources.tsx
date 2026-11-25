// Hospitals, clinics, police and fire stations near the traveller, from OpenStreetMap.
// Shows only what the map data says: no invented phone numbers, and a clinic is never presented as an emergency department.
import React, { useState } from 'react';
import { Building2, Stethoscope, Shield, Flame, Navigation, Phone, RotateCcw, Loader2, MapPin } from 'lucide-react';
import {
  classify, directionsUrl, getPosition, LOCATION_MESSAGE, nearbyFacilities, osmUrl,
  type Facility, type FacilitiesResult,
} from '@/services/emergency';
import { telHref } from '@/data/emergencyNumbers';

const KIND: Record<Facility['kind'], { label: string; Icon: typeof Building2 }> = {
  hospital: { label: 'Hospital', Icon: Building2 },
  clinic: { label: 'Clinic', Icon: Stethoscope },
  police: { label: 'Police station', Icon: Shield },
  fire_station: { label: 'Fire station', Icon: Flame },
};

const FILTERS: { key: 'all' | Facility['kind']; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'hospital', label: 'Hospitals' }, { key: 'clinic', label: 'Clinics' },
  { key: 'police', label: 'Police' }, { key: 'fire_station', label: 'Fire' },
];

const distance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

function emergencyText(f: Facility): string | null {
  if (f.kind === 'hospital') {
    return f.has_emergency === true ? 'Mapped as having an emergency department'
      : f.has_emergency === false ? 'Mapped as having no emergency department'
      : 'Emergency department not recorded in the map data';
  }
  if (f.kind === 'clinic') return f.has_emergency === true ? 'Mapped as offering emergency care' : 'Not an emergency department unless confirmed';
  return null;
}

type State =
  | { s: 'idle' }
  | { s: 'locating' }
  | { s: 'loading' }
  | { s: 'location-error'; message: string }
  | { s: 'error'; message: string }
  | { s: 'ready'; data: FacilitiesResult };

export const NearbyResources: React.FC = () => {
  const [state, setState] = useState<State>({ s: 'idle' });
  const [radius, setRadius] = useState(5000);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [pos, setPos] = useState<{ latitude: number; longitude: number } | null>(null);

  const load = async (r = radius, p = pos) => {
    let at = p;
    if (!at) {
      setState({ s: 'locating' });
      const loc = await getPosition(12_000);
      if (!loc.ok) {
        setState({ s: 'location-error', message: LOCATION_MESSAGE[loc.reason].replace(', so your position was not included', '') });
        return;
      }
      at = { latitude: loc.latitude, longitude: loc.longitude };
      setPos(at);
    }
    setState({ s: 'loading' });
    try {
      setState({ s: 'ready', data: await nearbyFacilities(at.latitude, at.longitude, r) });
    } catch (err) {
      const kind = classify(err);
      setState({ s: 'error', message: kind === 'offline' ? 'You are offline, so nearby facilities can’t be looked up.'
        : kind === 'session' ? 'Sign in to look up nearby facilities.'
        : kind === 'rate_limited' ? 'Too many lookups in a short time. Wait a minute and try again.'
        : 'The facility lookup service is unavailable right now.' });
    }
  };

  const widen = (r: number) => { setRadius(r); void load(r); };
  const data = state.s === 'ready' ? state.data : null;
  const shown = data ? data.facilities.filter(f => filter === 'all' || f.kind === filter) : [];
  const retrieved = data?.facilities.map(f => f.retrieved_at).filter(Boolean).sort()[0];

  return (
    <section className="nearby-panel" aria-labelledby="nearby-title">
      <div className="nearby-head">
        <div>
          <h3 id="nearby-title" className="preview-heading">Nearby hospitals, clinics, police and fire stations</h3>
          <p className="preview-subtext">From OpenStreetMap. Uses your location only for this lookup.</p>
        </div>
        {state.s === 'idle' && (
          <button type="button" className="btn-primary-green" onClick={() => load()}><MapPin size={16} /> Find nearby</button>
        )}
      </div>

      {(state.s === 'locating' || state.s === 'loading') && (
        <p className="nearby-status" role="status"><Loader2 size={14} className="sos-spinner" />
          {state.s === 'locating' ? ' Getting your location…' : ' Looking up nearby facilities…'}</p>
      )}

      {(state.s === 'location-error' || state.s === 'error') && (
        <div className="nearby-status nearby-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="btn-outline-neutral" onClick={() => load()}><RotateCcw size={14} /> Try again</button>
        </div>
      )}

      {data && (
        <>
          {data.error ? (
            <div className="nearby-status nearby-error" role="alert">
              <p>The OpenStreetMap lookup failed, so this is not a list of what’s nearby. Try again shortly.</p>
              <button type="button" className="btn-outline-neutral" onClick={() => load()}><RotateCcw size={14} /> Try again</button>
            </div>
          ) : data.facilities.length === 0 ? (
            <div className="nearby-status">
              <p>No hospitals, clinics, police or fire stations are mapped in OpenStreetMap within {distance(data.radius_m)}.
                That doesn’t mean none exist — the map may be incomplete here.</p>
              {data.radius_m < 25000 && (
                <button type="button" className="btn-outline-neutral" onClick={() => widen(data.radius_m < 10000 ? 10000 : 25000)}>
                  Search a wider area
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="nearby-filters" role="group" aria-label="Filter facilities">
                {FILTERS.map(f => (
                  <button key={f.key} type="button" className={`contact-chip ${filter === f.key ? 'selected' : ''}`}
                    onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}>{f.label}</button>
                ))}
              </div>
              {shown.length === 0 && <p className="nearby-status">None of this type mapped within {distance(data.radius_m)}.</p>}
              <ul className="nearby-list">
                {shown.map(f => {
                  const { label, Icon } = KIND[f.kind];
                  const em = emergencyText(f);
                  return (
                    <li key={f.osm_id} className="nearby-item">
                      <Icon size={18} className={`nearby-icon kind-${f.kind}`} aria-hidden="true" />
                      <div className="nearby-body">
                        <p className="nearby-name">{f.name || `Unnamed ${label.toLowerCase()}`}</p>
                        <p className="nearby-meta">{label} · {distance(f.distance_m)} away (straight line)</p>
                        {em && <p className="nearby-meta">{em}</p>}
                        <div className="nearby-actions">
                          <a href={directionsUrl(f)} target="_blank" rel="noreferrer"><Navigation size={13} /> Directions</a>
                          {f.phone
                            ? <a href={telHref(f.phone)}><Phone size={13} /> {f.phone}</a>
                            : <span className="nearby-muted">No phone number in the map data</span>}
                          <a href={osmUrl(f.osm_id)} target="_blank" rel="noreferrer" className="nearby-muted">Map record</a>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p className="call-panel-fineprint">
            Source: {data.source} ({data.licence}).{retrieved ? ` Retrieved ${new Date(retrieved).toLocaleDateString()}.` : ''}
            {' '}Within {distance(data.radius_m)} of you. Phone numbers and opening hours may be out of date.
          </p>
        </>
      )}
    </section>
  );
};

export default NearbyResources;
