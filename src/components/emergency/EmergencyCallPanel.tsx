// Emergency numbers for the traveller's country, with where each number came from.
// Works without the server: the table is bundled with the app and the last country is remembered on this device.
import React, { useEffect, useState } from 'react';
import { Phone, MapPin, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { EMERGENCY_NUMBERS, numbersFor, telHref } from '@/data/emergencyNumbers';
import { countryAt, getPosition, loadCountry, saveCountry, LOCATION_MESSAGE, type StoredCountry } from '@/services/emergency';

const countryName = (code: string) => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; }
};

interface Props {
  /** A position the parent already has (e.g. from the SOS flow); used to resolve the country without asking again. */
  position?: { latitude: number; longitude: number } | null;
  compact?: boolean;
}

export const EmergencyCallPanel: React.FC<Props> = ({ position, compact = false }) => {
  const [country, setCountry] = useState<StoredCountry | null>(() => loadCountry());
  const [fresh, setFresh] = useState(false);       // resolved from location during this visit
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const resolveFrom = async (lat: number, lon: number) => {
    const code = await countryAt(lat, lon);
    if (code) {
      const c: StoredCountry = { code, source: 'location', at: new Date().toISOString() };
      saveCountry(c);
      setCountry(c);
      setFresh(true);
      setProblem(null);
    } else {
      setProblem('TravelSphere could not work out the country from your location. Choose it below.');
    }
  };

  useEffect(() => {
    if (position) void resolveFrom(position.latitude, position.longitude);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.latitude, position?.longitude]);

  const locate = async () => {
    setBusy(true);
    setProblem(null);
    const loc = await getPosition();
    if (loc.ok) await resolveFrom(loc.latitude, loc.longitude);
    else setProblem(`${LOCATION_MESSAGE[loc.reason].replace(', so your position was not included', '')} Choose your country below.`);
    setBusy(false);
  };

  const choose = (code: string) => {
    if (!code) return;
    const c: StoredCountry = { code, source: 'manual', at: new Date().toISOString() };
    saveCountry(c);
    setCountry(c);
    setFresh(false);
  };

  const entry = numbersFor(country?.code);
  const origin = !country ? null
    : country.source === 'manual' ? 'chosen by you'
    : fresh ? 'from your current location'
    : `from your location on ${new Date(country.at).toLocaleDateString()} — may be out of date`;

  return (
    <section className={`call-panel ${compact ? 'call-panel-compact' : ''}`} aria-labelledby="call-panel-title">
      <h3 id="call-panel-title" className="call-panel-title"><Phone size={16} /> Call emergency services</h3>

      <p className="call-panel-country">
        <MapPin size={14} />
        {country ? <span><strong>{countryName(country.code)}</strong> ({origin})</span> : <span>Country not known yet.</span>}
        <button type="button" className="call-panel-link" onClick={locate} disabled={busy}>
          {busy ? <><Loader2 size={12} className="sos-spinner" /> Locating…</> : 'Use my location'}
        </button>
      </p>
      {problem && <p className="call-panel-problem" role="status">{problem}</p>}

      {entry ? (
        <>
          <div className="call-panel-numbers">
            {entry.numbers.map(n => (
              <a key={`${n.service}-${n.number}`} className="call-number" href={telHref(n.number)}>
                <span className="call-number-digits">{n.number}</span>
                <span className="call-number-label">{n.label}</span>
              </a>
            ))}
          </div>
          <p className={`call-panel-source ${entry.verification}`}>
            {entry.verification === 'verified' ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
            <span>
              {entry.verification === 'verified'
                ? <>Checked against the official source on {entry.checked}: </>
                : <>Not yet confirmed: the official page could not be checked automatically on {entry.checked}. Double-check locally. Source: </>}
              <a href={entry.source.url} target="_blank" rel="noreferrer">{entry.source.title}</a>.
              {entry.note ? ` ${entry.note}` : ''}
            </span>
          </p>
        </>
      ) : country ? (
        <p className="call-panel-problem">
          TravelSphere has no verified emergency number for {countryName(country.code)}. Check an official local source,
          your accommodation or a local person.
        </p>
      ) : null}

      <label className="call-panel-select">
        <span>{country ? 'Wrong country?' : 'Choose your country'}</span>
        <select value={entry ? entry.code : ''} onChange={e => choose(e.target.value)} aria-label="Choose your country">
          <option value="">Select a country…</option>
          {EMERGENCY_NUMBERS.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </label>

      <p className="call-panel-fineprint">
        Tapping a number opens your phone’s dialler. TravelSphere can’t tell whether the call connected.
      </p>
    </section>
  );
};

export default EmergencyCallPanel;
