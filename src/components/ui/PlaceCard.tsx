import React from 'react';
import { ArrowUpRight, MapPinned } from 'lucide-react';
import Photo from './Photo';
import SafetyMeter from './SafetyMeter';
import type { DestinationRecord } from '@/data/destinations';
import { PANORAMAS } from '@/data/panoramas';
import type { ConditionsState } from '@/services/conditions';

interface PlaceCardProps {
  destination: DestinationRecord;
  onPlan: (id: string) => void;
  onOpen?: (id: string) => void;
  onMap?: (d: DestinationRecord) => void;
  conditions?: ConditionsState;
  priority?: boolean;
}

/** Destination card — same anatomy as TripCard so the two sit side by side cleanly. */
const PlaceCard: React.FC<PlaceCardProps> = ({ destination: d, onPlan, onOpen, onMap, conditions, priority }) => (
  <article className="tcard pcard">
    <button type="button" className="pcard-open" onClick={() => onOpen?.(d.id)} disabled={!onOpen} aria-label={`Open ${d.city}`}>
      <Photo
        src={d.imageUrl}
        alt={d.imageCaption ? `${d.imageCaption}, ${d.city}` : d.name}
        width={360}
        ratio="4 / 3"
        caption={d.imageCaption}
        priority={priority}
        className="tcard-photo"
      >
        {PANORAMAS[d.id] && <span className="pcard-360">360°</span>}
      </Photo>
    </button>
    <div className="tcard-body">
      <div className="tcard-title-row">
        <h3 className="tcard-title">
          {onOpen ? <button type="button" className="pcard-title-link" onClick={() => onOpen(d.id)}>{d.city}</button> : d.city}
        </h3>
        <span className="tcard-provider">{d.airport}</span>
      </div>
      <p className="pcard-country">{d.country}</p>
      <p className="pcard-desc">{d.description}</p>
      {conditions && <SafetyMeter placeId={d.id} conditions={conditions} onOpen={onOpen ? () => onOpen(d.id) : undefined} />}
    </div>
    <footer className="pcard-foot">
      <span className="pcard-price">
        from <strong>${d.averageCost.low}</strong>/day
      </span>
      <div className="pcard-actions">
        {onMap && (
          <button type="button" className="icon-btn is-outlined" onClick={() => onMap(d)} aria-label={`View ${d.city} on the map`}>
            <MapPinned size={18} />
          </button>
        )}
        <button type="button" className="btn btn-soft btn-sm" onClick={() => onPlan(d.id)}>
          Plan trip <ArrowUpRight size={16} />
        </button>
      </div>
    </footer>
  </article>
);

export default PlaceCard;
