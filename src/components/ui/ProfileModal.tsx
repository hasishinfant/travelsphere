import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getUser, updateUser, HOME_AIRPORTS } from '@/services/tripStore';
import { api, getSession, ApiError } from '@/services/apiClient';

interface ProfileModalProps {
  onClose: () => void;
}

/** "Finish your profile" — name + home airport (used for route codes on trip cards). */
const ProfileModal: React.FC<ProfileModalProps> = ({ onClose }) => {
  const user = getUser();
  const [name, setName] = useState(user?.name || '');
  const [home, setHome] = useState(user?.homeAirport || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Please enter your name');
    if (!home) return setError('Please choose your home airport');
    const airport = HOME_AIRPORTS.find(a => a.code === home);
    setSaving(true);
    try {
      if (getSession()) {
        await api('/profile', { method: 'PUT', body: { full_name: name.trim(), home_airport: home, home_city: airport?.city ?? null } });
      }
      updateUser({ name: name.trim(), homeAirport: home, homeCity: airport?.city });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <form
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        noValidate
      >
        <div className="modal-header">
          <h2 id="profile-title" style={{ fontSize: 'var(--fs-xl)' }}>Your profile</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
          <label className="field">
            <span className="field-label">Full name</span>
            <input className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Home airport</span>
            <select className="input" value={home} onChange={e => setHome(e.target.value)}>
              <option value="">Choose an airport</option>
              {HOME_AIRPORTS.map(a => (
                <option key={a.code} value={a.code}>{a.city} ({a.code})</option>
              ))}
            </select>
            <span className="text-muted" style={{ fontSize: 'var(--fs-sm)' }}>
              Used as the departure point on your trip routes.
            </span>
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-8)' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        </div>
      </form>
    </div>
  );
};

export default ProfileModal;
