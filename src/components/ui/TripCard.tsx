import React from 'react';
import { ArrowRight, Zap, Users } from 'lucide-react';
import Photo from './Photo';
import { fmtDay, type Trip } from '@/services/tripStore';

interface TripCardProps {
  trip: Trip;
  origin?: string;
  selected?: boolean;
  onSelect?: () => void;
  onOpen: () => void;
  priority?: boolean;
}

/**
 * Trip card from the reference: photo, city + provider, route codes, date footer.
 * The selected card gets a soft accent footer (no dark fills).
 */
const TripCard: React.FC<TripCardProps> = ({ trip, origin, selected, onSelect, onOpen, priority }) => {
  const route = [origin || 'HOME', trip.airport || trip.title.slice(0, 3).toUpperCase()];

  return (
    <article
      className={`tcard ${selected ? 'is-selected' : ''}`}
      onClick={onSelect || onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          (onSelect || onOpen)();
        }
      }}
      tabIndex={0}
      role="button"
      aria-pressed={onSelect ? selected : undefined}
      aria-label={`${trip.title}, ${trip.subtitle}${trip.startDate ? `, departs ${fmtDay(trip.startDate)}` : ''}`}
    >
      <Photo
        src={trip.image}
        alt={trip.imageCaption ? `${trip.imageCaption}, ${trip.title}` : trip.title}
        width={360}
        ratio="3 / 2"
        caption={trip.imageCaption}
        priority={priority}
        className="tcard-photo"
      >
        <button
          type="button"
          className="tcard-details"
          onClick={e => { e.stopPropagation(); onOpen(); }}
        >
          <Zap size={16} strokeWidth={2} className="tcard-details-icon" />
          Details
        </button>
      </Photo>

      <div className="tcard-body">
        <div className="tcard-title-row">
          <h3 className="tcard-title">{trip.title}</h3>
          <span className="tcard-provider">{trip.provider}</span>
        </div>
        <div className="route" aria-label={`Route ${route.join(' to ')}`}>
          <span className="route-code is-end">{route[0]}</span>
          <ArrowRight size={14} className="route-arrow" />
          <span className="route-code is-end">{route[1]}</span>
          {trip.days && <span className="tcard-days">{trip.days} days</span>}
        </div>
      </div>

      <footer className="tcard-foot">
        <span className="tcard-date">
          <strong>{fmtDay(trip.startDate)}</strong>
          {trip.endDate && <span> – {fmtDay(trip.endDate)}</span>}
        </span>
        <span className="tcard-travelers" title={`${trip.travelers} traveller${trip.travelers > 1 ? 's' : ''}`}>
          <Users size={14} /> {trip.travelers}
        </span>
      </footer>
    </article>
  );
};

export default TripCard;
