// One server incident: status in plain words, its audit trail, notes, and (for responders) status changes.
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, MapPin, RefreshCw, Send, Siren, ShieldCheck, Loader2 } from 'lucide-react';
import { getSession } from '@/services/apiClient';
import {
  addIncidentLocation, addIncidentNote, CATEGORY_LABEL, changeIncidentStatus, classify, getIncident, getPosition,
  LOCATION_MESSAGE, NOT_DISPATCH, STATUS_TEXT, statusText, TRANSITIONS,
  type Incident, type IncidentStatus, type IncidentUpdate,
} from '@/services/emergency';
import { EmergencyCallPanel } from './EmergencyCallPanel';

type Loaded = Incident & { updates: IncidentUpdate[] };

const DETAIL_LABEL: Record<string, string> = {
  assistance_type: 'Type', urgency: 'Urgency', location_text: 'Location (as written)', contact_number: 'Contact number',
  contact_preference: 'Contact by', insurance_provider: 'Insurance', conditions_or_allergies: 'Conditions or allergies',
  document_type: 'Document', issuing_country: 'Issuing country', incident_date: 'Date lost', police_report_filed: 'Police report filed',
  police_report_number: 'Police report number', upcoming_departure_date: 'Next departure', location_status: 'Location',
};
const LOCATION_STATUS: Record<string, string> = {
  captured: 'GPS captured', denied: 'Permission blocked', timeout: 'GPS timed out', unavailable: 'GPS unavailable',
  unsupported: 'Browser cannot share location', manual: 'Typed by the traveller',
};
const fmtDetail = (k: string, v: unknown) =>
  k === 'location_status' ? LOCATION_STATUS[String(v)] ?? String(v)
  : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v).replace(/_/g, ' ');
const when = (iso: string) => new Date(iso).toLocaleString();

interface Props {
  incidentId: string;
  onBack: () => void;
  /** Responder view: shows status controls. The server enforces the role regardless. */
  staff?: boolean;
}

export const IncidentDetailView: React.FC<Props> = ({ incidentId, onBack, staff = false }) => {
  const [incident, setIncident] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIncident(await getIncident(incidentId));
      setError(null);
      setCheckedAt(new Date());
    } catch (err) {
      const kind = classify(err);
      setError(kind === 'offline' || kind === 'network' ? 'TravelSphere’s server can’t be reached, so the latest status can’t be shown.'
        : kind === 'session' ? 'Sign in to see this incident.'
        : 'This incident was not found, or you don’t have access to it.');
    }
  }, [incidentId]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000); // status changes only come from responders; check regularly
    return () => clearInterval(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage(ok);
      await load();
    } catch (err) {
      const kind = classify(err);
      setMessage(kind === 'offline' || kind === 'network' ? 'Not saved: the server can’t be reached.'
        : kind === 'validation' ? 'Not saved: the server rejected this change.' : 'Not saved: the server refused or failed.');
    } finally {
      setBusy(false);
    }
  };

  const sendNote = () => note.trim() && act(async () => { await addIncidentNote(incidentId, note.trim()); setNote(''); }, 'Note added.');
  const addLocation = async () => {
    setBusy(true);
    setMessage('Getting your location…');
    const loc = await getPosition(15_000);
    setBusy(false);
    if (!loc.ok) { setMessage(LOCATION_MESSAGE[loc.reason].replace(', so your position was not included', '')); return; }
    await act(() => addIncidentLocation(incidentId,
      { latitude: loc.latitude, longitude: loc.longitude, location_accuracy_m: Math.round(loc.accuracy) }), 'Location added.');
  };
  const setStatus = (status: IncidentStatus, extra: { assigned_to?: string; verified?: boolean } = {}) =>
    act(() => changeIncidentStatus(incidentId, { status, ...extra, ...(note.trim() ? { note: note.trim() } : {}) })
      .then(() => setNote('')), 'Status saved. The reporter is notified in the app.');

  if (!incident) {
    return (
      <div className="emergency-form-container">
        <button type="button" className="back-link-btn" onClick={onBack}><ArrowLeft size={18} /> Back</button>
        {error ? <div className="nearby-status nearby-error" role="alert"><p>{error}</p>
          <button type="button" className="btn-outline-neutral" onClick={load}><RefreshCw size={14} /> Try again</button></div>
          : <p className="nearby-status" role="status"><Loader2 size={14} className="sos-spinner" /> Loading incident…</p>}
      </div>
    );
  }

  const status = statusText(incident);
  const active = ['open', 'acknowledged', 'in_progress'].includes(incident.status);
  const me = getSession()?.userId;
  const details = Object.entries(incident.details || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined);

  return (
    <div className="emergency-form-container incident-detail">
      <div className="form-header-bar">
        <button type="button" className="back-link-btn" onClick={onBack}><ArrowLeft size={18} /> <span>Back</span></button>
        <div className="form-header-title-row">
          <div className="header-icon-pill bg-rose-50 text-rose-600 border border-rose-200"><Siren size={24} /></div>
          <div>
            <h1 className="form-title">{incident.is_sos ? 'SOS' : incident.title} · {incident.reference}</h1>
            <p className="form-subtitle">{CATEGORY_LABEL[incident.category]} · {incident.priority} priority · registered {when(incident.created_at)}</p>
          </div>
        </div>
      </div>

      <div className={`incident-status-banner status-${incident.status}`} role="status">
        <strong>{status.short}</strong>
        <span>{status.long}</span>
        {incident.verified && <span className="incident-verified"><ShieldCheck size={13} /> Verified by a responder</span>}
      </div>
      {!staff && <p className="incident-outcome-note">{NOT_DISPATCH}</p>}
      {error && <p className="call-panel-problem" role="alert">{error}</p>}
      <p className="call-panel-fineprint">
        Last checked {checkedAt?.toLocaleTimeString()}. Checks again every 30 seconds while this page is open.
        <button type="button" className="call-panel-link" onClick={load}><RefreshCw size={12} /> Check now</button>
      </p>

      <dl className="incident-facts">
        {incident.description && <div><dt>Description</dt><dd>{incident.description}</dd></div>}
        <div><dt>Location</dt><dd>{incident.latitude !== null
          ? <a href={`https://www.openstreetmap.org/?mlat=${incident.latitude}&mlon=${incident.longitude}#map=16/${incident.latitude}/${incident.longitude}`}
              target="_blank" rel="noreferrer">{Number(incident.latitude).toFixed(4)}, {Number(incident.longitude).toFixed(4)}
              {incident.location_accuracy_m ? ` (±${Math.round(Number(incident.location_accuracy_m))} m)` : ''}</a>
          : 'No GPS location'}</dd></div>
        {details.map(([k, v]) => <div key={k}><dt>{DETAIL_LABEL[k] ?? k}</dt><dd>{fmtDetail(k, v)}</dd></div>)}
      </dl>

      {!staff && active && incident.latitude === null && (
        <button type="button" className="btn-outline-neutral" onClick={addLocation} disabled={busy}><MapPin size={16} /> Add my location</button>
      )}

      <h3 className="preview-heading incident-timeline-title">History</h3>
      <ol className="incident-timeline">
        <li><span className="incident-timeline-time">{when(incident.created_at)}</span>
          <span><strong>Registered</strong> by {staff ? 'the traveller' : 'you'}.</span></li>
        {incident.updates.map(u => (
          <li key={u.id}>
            <span className="incident-timeline-time">{when(u.created_at)}</span>
            <span>
              <strong>{u.by_responder ? (staff && u.author_id === me ? 'You (responder)' : 'TravelSphere responder')
                : staff ? 'Traveller' : 'You'}</strong>
              {u.status ? `: status set to “${STATUS_TEXT[u.status].short}”` : ''}
              {u.note ? ` — ${u.note}` : ''}
            </span>
          </li>
        ))}
      </ol>

      <div className="incident-note-box">
        <label className="field-label" htmlFor="incident-note">{staff ? 'Note (sent with a status change, or on its own)' : 'Add information for responders'}</label>
        <textarea id="incident-note" className="textarea-input" rows={3} maxLength={2000} value={note}
          onChange={e => setNote(e.target.value)} />
        <button type="button" className="btn-outline-neutral" onClick={sendNote} disabled={busy || !note.trim()}>
          <Send size={14} /> Add note
        </button>
      </div>

      {staff && (
        <div className="incident-staff-actions">
          <h3 className="preview-heading">Responder actions</h3>
          <p className="call-panel-fineprint">Only change a status when it is true. “Acknowledged” tells the traveller a person has seen it.</p>
          <div className="nearby-filters">
            {TRANSITIONS[incident.status].map(s => (
              <button key={s} type="button" className="contact-chip" disabled={busy} onClick={() => setStatus(s)}>
                Mark {STATUS_TEXT[s].short.toLowerCase()}
              </button>
            ))}
            {active && me && incident.assigned_to !== me && (
              <button type="button" className="contact-chip" disabled={busy}
                onClick={() => setStatus(incident.status === 'open' ? 'acknowledged' : incident.status, { assigned_to: me })}>
                Assign to me{incident.status === 'open' ? ' (and acknowledge)' : ''}
              </button>
            )}
            {!incident.verified && (
              <button type="button" className="contact-chip" disabled={busy} onClick={() => setStatus(incident.status, { verified: true })}>
                Mark verified
              </button>
            )}
          </div>
        </div>
      )}

      {message && <p className="sos-modal-desc" role="status">{message}</p>}
      {!staff && active && <EmergencyCallPanel compact />}
    </div>
  );
};

export default IncidentDetailView;
