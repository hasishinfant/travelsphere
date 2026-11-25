// Responder console: every incident, highest priority first. Only responder/admin accounts can load it —
// the API refuses everyone else (403), and this page checks the role only to explain that.
import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ensureSession } from '@/services/apiClient';
import { getMyRole, STATUS_TEXT, type IncidentStatus } from '@/services/emergency';
import { IncidentList } from './IncidentList';

const FILTERS: (IncidentStatus | 'all')[] = ['open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'all'];

export const ResponderConsole: React.FC<{ onBack: () => void; onSelect: (id: string) => void }> = ({ onBack, onSelect }) => {
  const [role, setRole] = useState<'loading' | 'staff' | 'not-staff' | 'unavailable'>('loading');
  const [filter, setFilter] = useState<IncidentStatus | 'all'>('open');

  useEffect(() => {
    (async () => {
      if (!(await ensureSession())) { setRole('unavailable'); return; }
      try {
        const p = await getMyRole();
        setRole(p.role === 'responder' || p.role === 'admin' ? 'staff' : 'not-staff');
      } catch {
        setRole('unavailable');
      }
    })();
  }, []);

  return (
    <div className="emergency-form-container">
      <div className="form-header-bar">
        <button type="button" className="back-link-btn" onClick={onBack}><ArrowLeft size={18} /> <span>Back</span></button>
        <h1 className="form-title">Responder console</h1>
        <p className="form-subtitle">Incidents registered by travellers. Changing a status notifies the traveller in the app.</p>
      </div>
      {role === 'loading' && <p className="nearby-status">Checking your account…</p>}
      {role === 'not-staff' && <p className="nearby-status">This account is not a TravelSphere responder account.</p>}
      {role === 'unavailable' && <p className="nearby-status nearby-error">TravelSphere’s server can’t be reached or you are not signed in.</p>}
      {role === 'staff' && (
        <>
          <div className="nearby-filters" role="group" aria-label="Filter by status">
            {FILTERS.map(f => (
              <button key={f} type="button" className={`contact-chip ${filter === f ? 'selected' : ''}`} aria-pressed={filter === f}
                onClick={() => setFilter(f)}>{f === 'all' ? 'All' : STATUS_TEXT[f].short}</button>
            ))}
          </div>
          <IncidentList scope="all" status={filter === 'all' ? undefined : filter} onSelect={onSelect}
            emptyText="No incidents with this status." />
        </>
      )}
    </div>
  );
};

export default ResponderConsole;
