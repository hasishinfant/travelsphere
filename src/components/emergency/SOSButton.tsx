// SOS: registers a critical incident (with location when available) on the TravelSphere server, and always offers
// the local emergency numbers. Every state on screen reflects what has actually happened.
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, MapPin, MessageSquare, X } from 'lucide-react';
import { EmergencyCallPanel } from './EmergencyCallPanel';
import { IncidentNotRegistered, IncidentRegistered } from './IncidentOutcome';
import {
  addIncidentLocation, getPosition, LOCATION_MESSAGE, newRequestId, registerIncident, SubmitError, FAILURE_MESSAGE,
  type LocationResult, type Registration,
} from '@/services/emergency';

type Phase = 'idle' | 'confirm' | 'locating' | 'creating' | 'registered' | 'failed';

interface SOSButtonProps {
  className?: string;
  onTrack?: (incidentId: string) => void;
}

export const SOSButton: React.FC<SOSButtonProps> = ({ className = '', onTrack }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [location, setLocation] = useState<LocationResult | null>(null);
  const [locationUpdate, setLocationUpdate] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);   // one per SOS: retries and double taps reuse it (server idempotency)
  const inFlight = useRef(false);
  const skipLocation = useRef<(() => void) | null>(null);

  const busy = phase === 'locating' || phase === 'creating';

  useEffect(() => {
    if (phase === 'idle') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const open = () => {
    setFailure(null);
    setPhase('confirm');
  };

  const close = () => {
    if (busy) return;
    if (phase === 'registered') { requestId.current = null; setLocation(null); setLocationUpdate(null); }
    if (phase === 'failed' || phase === 'confirm') { requestId.current = null; setLocation(null); }
    setPhase('idle');
  };

  const submit = async () => {
    if (inFlight.current) return;            // duplicate activation while a request is running
    inFlight.current = true;
    requestId.current ??= newRequestId();
    setFailure(null);
    try {
      let loc = location;
      if (!loc || !loc.ok) {
        setPhase('locating');
        loc = await Promise.race([
          getPosition(10_000),
          new Promise<LocationResult>(resolve => { skipLocation.current = () => resolve({ ok: false, reason: 'unavailable' }); }),
        ]);
        skipLocation.current = null;
        setLocation(loc);
      }
      setPhase('creating');
      const reg = await registerIncident({
        category: 'other', title: 'SOS', is_sos: true, client_request_id: requestId.current,
        description: 'SOS activated in the TravelSphere app.',
        ...(loc.ok ? { latitude: loc.latitude, longitude: loc.longitude, location_accuracy_m: Math.round(loc.accuracy) } : {}),
        details: { location_status: loc.ok ? 'captured' : loc.reason },
      });
      setRegistration(reg);
      setPhase('registered');
    } catch (err) {
      setFailure(err instanceof SubmitError ? err.message : FAILURE_MESSAGE.server);
      setPhase('failed');
    } finally {
      inFlight.current = false;
    }
  };

  const retryLocation = async () => {
    if (!registration) return;
    setLocationUpdate('Getting your location…');
    const loc = await getPosition(15_000);
    if (!loc.ok) { setLocationUpdate(LOCATION_MESSAGE[loc.reason]); return; }
    try {
      const { incident } = await addIncidentLocation(registration.incident.id,
        { latitude: loc.latitude, longitude: loc.longitude, location_accuracy_m: Math.round(loc.accuracy) });
      setRegistration({ ...registration, incident });
      setLocation(loc);
      setLocationUpdate('Location added to the incident.');
    } catch {
      setLocationUpdate('Location found, but TravelSphere could not save it to the incident. Try again.');
    }
  };

  const locationNote = location && !location.ok ? LOCATION_MESSAGE[location.reason] : null;

  return (
    <>
      <button className={`sos-trigger-btn ${className}`} onClick={open} aria-label="SOS: emergency options" type="button">
        <span className="sos-pulse-ring" aria-hidden="true" />
        <span className="sos-btn-inner"><AlertTriangle size={22} strokeWidth={2.5} /><span>SOS</span></span>
      </button>

      {phase !== 'idle' && (
        <div className="sos-modal-overlay" role="dialog" aria-modal="true" aria-label="Emergency SOS">
          <div className="sos-modal-card sos-modal-wide">
            {!busy && (
              <button className="sos-modal-close" onClick={close} aria-label="Close SOS dialog"><X size={18} /></button>
            )}

            {phase === 'confirm' && (
              <>
                <div className="sos-modal-icon-wrap sos-icon-danger"><AlertTriangle size={28} strokeWidth={2.5} /></div>
                <h2 className="sos-modal-title">Emergency SOS</h2>
                <p className="sos-modal-desc"><strong>In danger? Call emergency services first.</strong></p>
                <EmergencyCallPanel compact />
                <div className="sos-register-box">
                  <p className="sos-modal-desc">
                    <strong>Register an SOS with TravelSphere</strong> to record the time and your location as a critical
                    incident for TravelSphere responder accounts. It does not contact police, ambulance or hospitals.
                  </p>
                  <button type="button" className="sos-primary-btn" onClick={submit}>
                    <MapPin size={16} /> Register SOS with my location
                  </button>
                  <button type="button" className="sos-cancel-btn" onClick={close}>Cancel</button>
                </div>
              </>
            )}

            {phase === 'locating' && (
              <>
                <div className="sos-modal-icon-wrap sos-icon-warning"><Loader2 size={30} className="sos-spinner" /></div>
                <h2 className="sos-modal-title">Getting your location…</h2>
                <p className="sos-modal-desc">Nothing has been sent yet. If your browser asks, allow location access.</p>
                <button type="button" className="sos-cancel-btn" onClick={() => skipLocation.current?.()}>
                  Send without location
                </button>
              </>
            )}

            {phase === 'creating' && (
              <>
                <div className="sos-modal-icon-wrap sos-icon-warning"><Loader2 size={30} className="sos-spinner" /></div>
                <h2 className="sos-modal-title">Creating incident…</h2>
                <p className="sos-modal-desc">Waiting for TravelSphere’s server to confirm. Nothing is registered until it does.</p>
              </>
            )}

            {phase === 'registered' && registration && (
              <IncidentRegistered registration={registration} locationNote={locationNote}
                onTrack={onTrack ? () => { const id = registration.incident.id; close(); onTrack(id); } : undefined}>
                {registration.incident.latitude === null && (
                  <div className="sos-register-box">
                    <button type="button" className="btn-outline-neutral" onClick={retryLocation}>
                      <MapPin size={16} /> Try adding my location
                    </button>
                    {locationUpdate && <p className="sos-modal-desc" role="status">{locationUpdate}</p>}
                  </div>
                )}
                <TextContact reference={registration.incident.reference} location={location} />
              </IncidentRegistered>
            )}

            {phase === 'failed' && failure && (
              <>
                <IncidentNotRegistered message={failure} onRetry={submit} retrying={busy} />
                <TextContact location={location} />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

/** Hands a prepared message to the device's messaging app. TravelSphere cannot send it or know whether it was sent. */
const TextContact: React.FC<{ reference?: string; location: LocationResult | null }> = ({ reference, location }) => {
  const [phone, setPhone] = useState('');
  const valid = phone.replace(/\D/g, '').length >= 7;
  const where = location?.ok ? `My location: https://www.openstreetmap.org/?mlat=${location.latitude.toFixed(5)}&mlon=${location.longitude.toFixed(5)}` : 'My location is not available.';
  const body = encodeURIComponent(`I need help. ${where}${reference ? ` TravelSphere SOS reference: ${reference}.` : ''}`);
  return (
    <details className="sos-text-contact">
      <summary><MessageSquare size={14} /> Text someone you trust</summary>
      <p className="sos-modal-desc">
        Opens your messaging app with a prepared message. You send it yourself; TravelSphere can’t send it or confirm it was sent.
      </p>
      <div className="sos-input-wrapper">
        <input type="tel" className="sos-phone-input" placeholder="Their phone number" value={phone} maxLength={20}
          onChange={e => setPhone(e.target.value)} aria-label="Contact phone number" autoComplete="tel" />
      </div>
      <a className={`btn-outline-neutral sos-sms-link ${valid ? '' : 'disabled'}`} aria-disabled={!valid}
        href={valid ? `sms:${phone.replace(/[^\d+]/g, '')}?body=${body}` : undefined}>
        Open messaging app
      </a>
    </details>
  );
};

export default SOSButton;
