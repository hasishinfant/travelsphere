import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Rotate3d, MapPinned, ArrowUpRight, RefreshCw, Thermometer, CloudRain, Wind, Info } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Photo from '@/components/ui/Photo';
import MapModal from '@/components/ui/MapModal';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import HazardOutlook from '@/components/ui/HazardOutlook';
import { getDestination } from '@/data/destinations';
import { PANORAMAS } from '@/data/panoramas';
import { ensureSession, ApiError } from '@/services/apiClient';
import { fetchAssessment, LEVEL_LABEL, minutesAgo, type Factor, type PlaceAssessment } from '@/services/conditions';
import './PlacePage.css';

// Three.js is only downloaded when the 360° view is opened
const PanoramaViewer = React.lazy(() => import('@/components/ui/PanoramaViewer'));

const STATUS_LABEL: Record<Factor['status'], string> = {
  live: 'Live data',
  derived: 'From your journey',
  configured: 'Configured',
  default: 'General assumption',
  unavailable: 'Unavailable',
};

const toneOf = (v: number | null) => (v === null ? 'none' : v >= 0.7 ? 'high' : v >= 0.4 ? 'moderate' : 'low');

const FactorCard: React.FC<{ f: Factor }> = ({ f }) => (
  <div className={`factor tone-${toneOf(f.value)} status-${f.status}`}>
    <div className="factor-head">
      <h4>{f.label}</h4>
      <span className="factor-status">{STATUS_LABEL[f.status]}</span>
    </div>
    <div className="factor-bar" aria-label={f.value === null ? 'No value' : `${Math.round(f.value * 100)} out of 100`}>
      <span style={{ width: `${f.value === null ? 0 : Math.max(4, f.value * 100)}%` }} />
    </div>
    <p className="factor-detail">{f.detail}</p>
  </div>
);

const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;
const DIMENSIONS: [string, string][] = [
  ['hazard', 'Hazard'], ['exposure', 'Exposure'], ['journey_context', 'Journey context'],
  ['response_capacity', 'Response capacity'], ['other', 'Other factors'],
];

const PlacePage: React.FC = () => {
  const { placeId = '' } = useParams<{ placeId: string }>();
  const navigate = useNavigate();
  const d = getDestination(placeId);
  const pano = d ? PANORAMAS[d.id] : undefined;
  const [assessment, setAssessment] = useState<PlaceAssessment | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'signed-out'>('loading');
  const [error, setError] = useState('');
  const [view360, setView360] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const close360 = useCallback(() => setView360(false), []);

  const load = useCallback(() => {
    if (!d) return;
    setState('loading');
    ensureSession()
      .then(ok => { if (!ok) throw Object.assign(new Error('signed-out'), { signedOut: true }); return fetchAssessment(d.id); })
      .then(a => { setAssessment(a); setState('idle'); })
      .catch(err => {
        if (err?.signedOut) { setState('signed-out'); return; }
        setError(err instanceof ApiError ? err.message : 'Could not load conditions');
        setState('error');
      });
  }, [d]);

  useEffect(load, [load]);

  if (!d) {
    return (
      <div className="page">
        <div className="surface empty-state">
          <h3>Place not found</h3>
          <p>We don’t have this destination in TravelSphere yet.</p>
          <Link to="/#explore" className="btn btn-primary" style={{ marginTop: 'var(--space-3)' }}>Browse destinations</Link>
        </div>
      </div>
    );
  }

  const level = assessment?.risk_level;
  const tone = level ? level.toLowerCase() : 'none';

  return (
    <div className="page place-page">
      <Link to="/#explore" className="back-link"><ArrowLeft size={16} /> Destinations</Link>
      <PageHeader title={d.city} subtitle={d.description} />

      <section className="surface place-hero">
        <Photo src={d.imageUrl} alt={d.imageCaption ? `${d.imageCaption}, ${d.city}` : d.name} width={640} ratio="4 / 3" caption={d.imageCaption} priority className="place-hero-photo" />
        <div className="place-hero-body">
          <p className="eyebrow">{d.country} · {d.airport}</p>
          <dl className="place-facts">
            <div><dt>Best time</dt><dd>{d.bestTimeToVisit}</dd></div>
            <div><dt>Daily budget</dt><dd>${d.averageCost.low} – ${d.averageCost.luxury}</dd></div>
            <div><dt>Highlights</dt><dd>{d.highlights.join(' · ')}</dd></div>
          </dl>
          <div className="place-actions">
            {pano ? (
              <button type="button" className="btn btn-primary" onClick={() => setView360(true)}>
                <Rotate3d size={18} /> View in 360°
              </button>
            ) : (
              <span className="place-no360">No verified 360° view for this place yet</span>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => navigate(`/plan-trip?destination=${d.id}`)}>
              Plan a trip <ArrowUpRight size={16} />
            </button>
            <button type="button" className="icon-btn is-outlined" onClick={() => setShowMap(true)} aria-label={`Map of ${d.city}`}>
              <MapPinned size={18} />
            </button>
          </div>
          {pano && <p className="place-pano-note">360° photo: {pano.caption}. A recorded photo, not a live feed.</p>}
        </div>
      </section>

      <section className="section" aria-labelledby="safety-title">
        <div className="section-head">
          <div>
            <h2 className="section-title" id="safety-title">Safety now</h2>
            <p className="section-sub">Assessed from 8 factors using live conditions, your journey and configured place data.</p>
          </div>
          {state === 'idle' && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={15} /> Refresh</button>
          )}
        </div>

        {state === 'signed-out' && (
          <div className="surface empty-state">
            <h3>Sign in to see live safety</h3>
            <p>Safety assessments use live conditions and your own journeys, so they need an account.</p>
          </div>
        )}
        {state === 'loading' && <div className="surface safety-loading"><LoadingSpinner size="md" message="Assessing current conditions…" /></div>}
        {state === 'error' && (
          <div className="notice notice-danger"><Info size={18} /> {error}. <button type="button" className="link-btn" onClick={load}>Try again</button></div>
        )}

        {state === 'idle' && assessment && (
          <>
            <div className={`surface safety-summary tone-${tone}`}>
              <div className="safety-summary-main">
                <p className="eyebrow">Risk level</p>
                <p className="safety-level">{level ? LEVEL_LABEL[level] : 'Not assessed'}</p>
                <p className="safety-headline">{assessment.reasons.join(' · ')}</p>
                <div className="safety-action">
                  <p className="eyebrow">Recommended action</p>
                  <p>{assessment.recommended_action}</p>
                </div>
              </div>
              <div className="safety-summary-side">
                {assessment.confidence ? (
                  <div className="safety-conf" title={assessment.confidence.explanation}>
                    <span className="safety-conf-num">{assessment.confidence.score}<small>/100</small></span>
                    <span className="safety-conf-label">
                      {CONFIDENCE_LABEL[assessment.confidence.level]} · {assessment.factors_available} of {assessment.factors_total ?? 8} factors
                      have data
                    </span>
                  </div>
                ) : (
                  <div className="safety-conf">
                    <span className="safety-conf-num">{assessment.factors_available}<small>/{assessment.factors_total ?? 8}</small></span>
                    <span className="safety-conf-label">factors backed by live or configured data</span>
                  </div>
                )}
                {assessment.weather && (
                  <ul className="safety-weather">
                    <li><Thermometer size={15} /> {assessment.weather.summary}{assessment.weather.temperatureC !== null ? `, ${assessment.weather.temperatureC} °C` : ''}</li>
                    <li><CloudRain size={15} /> Rain {assessment.weather.rainRateMmH ?? '—'} mm/h</li>
                    <li><Wind size={15} /> Gusts {assessment.weather.windGustMs ?? '—'} m/s</li>
                  </ul>
                )}
                <p className="safety-meta">
                  {assessment.observed_at ? `Observed ${minutesAgo(assessment.observed_at)} · Open-Meteo` : 'No current observation'}
                  {assessment.data_status === 'STALE' && ' · may be outdated'}
                </p>
              </div>
            </div>

            <HazardOutlook outlook={assessment.hazard_outlook} />

            {assessment.destination_score && assessment.destination_score.score !== null && (
              <div className="surface destination-score">
                <div>
                  <p className="eyebrow">Tourist Confidence Score</p>
                  <p className="destination-score-num">{Math.round(assessment.destination_score.score)}<small>/100</small>
                    <span> {assessment.destination_score.band}{assessment.destination_score.provisional ? ' · provisional' : ''}</span></p>
                  <p className="destination-score-note">
                    Background safety of the place (access to care, remoteness, hazard history); today's conditions are in
                    the risk level above.
                  </p>
                </div>
                <ul className="destination-score-parts">
                  {assessment.destination_score.components.map(c => (
                    <li key={c.key}><span>{c.label}</span><strong>{c.score === null ? 'not available' : Math.round(c.score)}</strong></li>
                  ))}
                </ul>
              </div>
            )}

            {DIMENSIONS.map(([dim, title]) => {
              const fs = assessment.factors.filter(f => (f.dimension ?? 'other') === dim);
              return fs.length ? (
                <div key={dim} className="factor-dimension">
                  <p className="eyebrow">{title}</p>
                  <div className="factor-grid">{fs.map(f => <FactorCard key={f.key} f={f} />)}</div>
                </div>
              ) : null;
            })}

            <p className="safety-footnote">
              Model {assessment.model_version} · {assessment.uncertainty}. {assessment.notice}
            </p>
          </>
        )}
      </section>

      {view360 && pano && (
        <Suspense fallback={<div className="pano-boot"><LoadingSpinner size="md" message="Opening 360° view…" /></div>}>
          <PanoramaViewer panorama={pano} placeName={d.name} onClose={close360}
            weather={assessment?.weather ?? null} weatherObservedAt={assessment?.observed_at ?? null} />
        </Suspense>
      )}
      {showMap && <MapModal destination={d} onClose={() => setShowMap(false)} />}
    </div>
  );
};

export default PlacePage;
