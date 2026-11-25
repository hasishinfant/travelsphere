// Incidents stored on the TravelSphere server: the traveller's own, or (responders) everyone's.
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { ensureSession } from '@/services/apiClient';
import { CATEGORY_LABEL, classify, listIncidents, statusText, type Incident, type IncidentStatus } from '@/services/emergency';

interface Props {
  scope?: 'mine' | 'all';
  status?: IncidentStatus;
  onSelect: (id: string) => void;
  /** Called with the loaded incidents (e.g. to show a count). */
  onLoaded?: (incidents: Incident[]) => void;
  limit?: number;
  emptyText?: string;
}

export const IncidentList: React.FC<Props> = ({ scope = 'mine', status, onSelect, onLoaded, limit, emptyText }) => {
  const [items, setItems] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    if (!(await ensureSession())) { setItems([]); setError('Sign in to see incidents registered with TravelSphere.'); return; }
    try {
      const list = await listIncidents(scope, status);
      setItems(list);
      onLoaded?.(list);
    } catch (err) {
      const kind = classify(err);
      setError(kind === 'offline' || kind === 'network' ? 'TravelSphere’s server can’t be reached, so incidents can’t be listed.'
        : kind === 'session' ? 'Sign in to see incidents registered with TravelSphere.' : 'Incidents could not be loaded.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, status]);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div className="nearby-status nearby-error" role="alert">
        <p>{error}</p>
        <button type="button" className="btn-outline-neutral" onClick={load}><RefreshCw size={14} /> Try again</button>
      </div>
    );
  }
  if (!items) return <p className="nearby-status" role="status"><Loader2 size={14} className="sos-spinner" /> Loading incidents…</p>;
  if (!items.length) return <p className="nearby-status">{emptyText ?? 'No incidents registered.'}</p>;

  return (
    <ul className="incident-list">
      {items.slice(0, limit ?? items.length).map(i => {
        const s = statusText(i);
        return (
          <li key={i.id}>
            <button type="button" className="incident-list-item" onClick={() => onSelect(i.id)}>
              <span className={`ticket-status-pill incident-pill status-${i.status}`}>{s.short}</span>
              <span className="incident-list-body">
                <strong>{i.is_sos ? 'SOS' : i.title}</strong>
                <span className="nearby-meta">{i.reference} · {CATEGORY_LABEL[i.category]} · {i.priority} priority ·
                  {' '}{new Date(i.created_at).toLocaleString()}</span>
              </span>
              <ChevronRight size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default IncidentList;
