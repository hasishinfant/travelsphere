// SOS: registers a critical incident (with location when available) on the TravelSphere server, and always offers
// the local emergency numbers. Every state on screen reflects what has actually happened.
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Ambulance, Car, CloudRainWind, FileWarning, Flame, Loader2, MapPin, MessageSquare, Navigation,
  ShieldAlert, Siren, Wallet, X } from 'lucide-react';
import { EmergencyCallPanel } from './EmergencyCallPanel';
import { IncidentNotRegistered, IncidentRegistered } from './IncidentOutcome';
import {
  addIncidentLocation, EMERGENCY_TYPES, getPosition, LOCATION_MESSAGE, newRequestId, registerIncident, SubmitError,
  FAILURE_MESSAGE, type DemoDispatch, type EmergencyTypeId, type LocationResult, type Registration,
} from '@/services/emergency';

const TYPE_ICON: Record<string, React.ReactNode> = {
  medical: <Ambulance size={20} />, accident: <Car size={20} />, theft: <Wallet size={20} />, assault: <ShieldAlert size={20} />,
  fire: <Flame size={20} />, natural_hazard: <CloudRainWind size={20} />, lost: <Navigation size={20} />,
  lost_documents: <FileWarning size={20} />, unsafe: <Siren size={20} />,
};

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
  const emergencyType = useRef<EmergencyTypeId>('other');   // fixed for the life of one SOS (retries reuse it)

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
    emergencyType.current = 'other';
    setPhase('idle');
  };

  const submit = async (type?: EmergencyTypeId) => {
    if (inFlight.current) return;            // duplicate activation while a request is running
    inFlight.current = true;
    if (!requestId.current && type) emergencyType.current = type;
    requestId.current ??= newRequestId();
    const t = EMERGENCY_TYPES.find(x => x.id === emergencyType.current);
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
        category: t?.category ?? 'other', title: t ? `SOS: ${t.label}` : 'SOS', is_sos: true,
        client_request_id: requestId.current,
        description: t ? `SOS activated in the TravelSphere app: ${t.label.toLowerCase()}.` : 'SOS activated in the TravelSphere app.',
        ...(loc.ok ? { latitude: loc.latitude, longitude: loc.longitude, location_accuracy_m: Math.round(loc.accuracy) } : {}),
        details: { location_status: loc.ok ? 'captured' : loc.reason, emergency_type: emergencyType.current },
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
                    <strong>What is happening?</strong> Tap one to register an SOS with TravelSphere: the time, the
                    emergency and your location are recorded as a critical incident for TravelSphere responders.
                    It does not contact police, ambulance or hospitals.
                  </p>
                  <div className="sos-type-grid" role="group" aria-label="Type of emergency">
                    {EMERGENCY_TYPES.map(t => (
                      <button key={t.id} type="button" className={`sos-type-btn sos-type-${t.id}`}
                        aria-label={`Send SOS: ${t.label}`} onClick={() => submit(t.id)}>
                        <span className="sos-type-icon" aria-hidden="true">{TYPE_ICON[t.id]}</span>
                        <span className="sos-type-text"><strong>{t.label}</strong><small>{t.hint}</small></span>
                      </button>
                    ))}
                  </div>
                  <button type="button" className="sos-primary-btn" onClick={() => submit('other')}>
                    <MapPin size={16} /> Register SOS with my location
                  </button>
                  <p className="sos-modal-hint">Can’t say what it is? Use this — it is sent as an unknown emergency.</p>
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
                <DemoDispatchNote d={registration.demo_dispatch} />
                <TextContact reference={registration.incident.reference} location={location} />
              </IncidentRegistered>
            )}

            {phase === 'failed' && failure && (
              <>
                <IncidentNotRegistered message={failure} onRetry={() => submit()} retrying={busy} />
                <TextContact location={location} />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

/** DEMO ONLY: shows exactly what the server's demo dispatcher did — sent, or not sent and why. */
const DemoDispatchNote: React.FC<{ d?: DemoDispatch | null }> = ({ d }) => {
  if (!d || d.status === 'disabled') return null;
  const sent = d.status === 'sent' || d.status === 'logged';
  return (
    <div className={`sos-demo-dispatch ${sent ? 'is-sent' : 'is-failed'}`} role="status">
      <p className="sos-demo-tag">Demo</p>
      <p>
        {d.status === 'sent' && <>Message handed to Messages for the demo <strong>{d.service}</strong> number ({d.to_masked}).</>}
        {d.status === 'logged' && <>Message for the demo <strong>{d.service}</strong> number ({d.to_masked}) was written to the server log only.</>}
        {d.status === 'failed' && <>The message to the demo <strong>{d.service}</strong> number was <strong>not sent</strong>
          {d.error ? `: ${d.error}` : ''}. Call the emergency number above.</>}
      </p>
      <p className="sos-demo-small">In this demo one phone number stands in for local emergency services. Real hospitals,
        police and 112 are not contacted.</p>
      {d.whatsapp_url && (
        <a className="btn-outline-neutral sos-demo-wa" href={d.whatsapp_url} target="_blank" rel="noopener noreferrer">
          {sent ? 'Also send it on WhatsApp' : 'Send it on WhatsApp instead'}
        </a>
      )}
      {d.message && (
        <details><summary>Message text</summary><pre className="sos-demo-message">{d.message}</pre></details>
      )}
    </div>
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
