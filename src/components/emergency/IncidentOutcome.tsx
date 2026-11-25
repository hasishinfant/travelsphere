// The two honest outcomes of submitting an incident: registered (with exactly what that means), or not registered.
import React from 'react';
import { CheckCircle2, XCircle, RotateCcw, Info } from 'lucide-react';
import { EmergencyCallPanel } from './EmergencyCallPanel';
import { NOT_DISPATCH, responderText, statusText, type Registration } from '@/services/emergency';

interface RegisteredProps {
  registration: Registration;
  /** Why the location is missing, when it is. */
  locationNote?: string | null;
  onTrack?: () => void;
  onBack?: () => void;
  children?: React.ReactNode;
}

export const IncidentRegistered: React.FC<RegisteredProps> = ({ registration, locationNote, onTrack, onBack, children }) => {
  const { incident, duplicate, responder_accounts } = registration;
  const status = statusText(incident);
  return (
    <div className="incident-outcome" role="status" aria-live="polite">
      <div className="incident-outcome-head ok">
        <CheckCircle2 size={22} />
        <div>
          <h2 className="incident-outcome-title">Incident registered</h2>
          <p>Reference <strong className="ref-code-inline">{incident.reference}</strong>
            {duplicate ? ' (already registered — this was the same request, not a second incident)' : ''}</p>
        </div>
      </div>
      <dl className="incident-facts">
        <div><dt>Status</dt><dd>{status.long}</dd></div>
        <div><dt>Who can see it</dt><dd>{responderText(responder_accounts)}</dd></div>
        <div><dt>Location</dt><dd>{incident.latitude !== null
          ? `Included (${Number(incident.latitude).toFixed(4)}, ${Number(incident.longitude).toFixed(4)})`
          : locationNote || 'Not included.'}</dd></div>
      </dl>
      <p className="incident-outcome-note"><Info size={14} /> {NOT_DISPATCH} If you are in danger, call now:</p>
      <EmergencyCallPanel compact position={incident.latitude !== null
        ? { latitude: Number(incident.latitude), longitude: Number(incident.longitude) } : null} />
      {children}
      {(onTrack || onBack) && (
        <div className="success-actions">
          {onTrack && <button type="button" className="btn-primary-green flex-1" onClick={onTrack}>View status and updates</button>}
          {onBack && <button type="button" className="btn-outline-neutral" onClick={onBack}>Back to Emergency Support</button>}
        </div>
      )}
    </div>
  );
};

interface FailedProps {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export const IncidentNotRegistered: React.FC<FailedProps> = ({ message, onRetry, retrying }) => (
  <div className="incident-outcome" role="alert">
    <div className="incident-outcome-head failed">
      <XCircle size={22} />
      <div>
        <h2 className="incident-outcome-title">Not registered</h2>
        <p>{message} Nobody at TravelSphere has been told.</p>
      </div>
    </div>
    <p className="incident-outcome-note"><Info size={14} /> If you need help now, contact emergency services directly:</p>
    <EmergencyCallPanel compact />
    {onRetry && (
      <button type="button" className="btn-outline-neutral incident-retry" onClick={onRetry} disabled={retrying}>
        <RotateCcw size={16} /> {retrying ? 'Trying again…' : 'Try again'}
      </button>
    )}
  </div>
);
