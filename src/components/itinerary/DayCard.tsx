import React, { useState } from 'react';
import {
  ChevronDown, Clock, Landmark, Trees, UtensilsCrossed, ShoppingBag, Waves, Building2,
  Mountain, Flower2, Drama, Cpu, Palette, Heart, MapPin, Lightbulb, type LucideIcon,
} from 'lucide-react';
import type { ItineraryDay, Place, FoodRecommendation } from '@/types/itinerary';

interface DayCardProps {
  day: ItineraryDay;
  defaultOpen?: boolean;
}

const CATEGORY_ICON: Record<string, LucideIcon> = {
  culture: Landmark, nature: Trees, food: UtensilsCrossed, shopping: ShoppingBag, beach: Waves,
  urban: Building2, adventure: Mountain, relaxation: Flower2, entertainment: Drama,
  technology: Cpu, art: Palette, romance: Heart,
};

const SLOTS = ['Morning', 'Afternoon', 'Evening'];

const DayCard: React.FC<DayCardProps> = ({ day, defaultOpen = true }) => {
  const [isExpanded, setIsExpanded] = useState(defaultOpen);
  const date = new Date(day.date);
  const dateLabel = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <article
      className={`day-card ${isExpanded ? 'is-open' : ''}`}
      id={`day-${day.dayNumber}`}
      data-testid={`day-card-${day.dayNumber}`}
    >
      <button
        type="button"
        className="day-header"
        onClick={() => setIsExpanded(v => !v)}
        aria-expanded={isExpanded}
      >
        <span className="day-badge">
          <span className="day-badge-label">Day</span>
          <span className="day-badge-num">{day.dayNumber}</span>
        </span>
        <span className="day-info">
          <span className="day-date">{dateLabel}</span>
          <span className="day-summary">
            {day.places?.map(p => p.name).join(' · ') || 'Free day'}
          </span>
        </span>
        <ChevronDown size={20} className="day-chevron" />
      </button>

      {isExpanded && (
        <div className="day-content">
          {day.places?.length > 0 && (
            <ol className="day-timeline">
              {day.places.map((place: Place, i: number) => {
                const Glyph = CATEGORY_ICON[place.category?.toLowerCase()] || MapPin;
                return (
                  <li key={`${place.name}-${i}`} className="day-stop">
                    <span className="day-stop-icon"><Glyph size={18} strokeWidth={1.75} /></span>
                    <div className="day-stop-body">
                      <p className="day-stop-slot">{SLOTS[i] || 'Later'}</p>
                      <h4>{place.name}</h4>
                      <p className="day-stop-desc">{place.description}</p>
                      <div className="day-stop-meta">
                        <span><Clock size={13} /> {place.estimatedTime}</span>
                        <span className="tag">{place.category}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="day-extras">
            {day.foodRecommendations?.length > 0 && (
              <section className="day-extra">
                <h5><UtensilsCrossed size={15} /> Where to eat</h5>
                <ul>
                  {day.foodRecommendations.map((food: FoodRecommendation, i: number) => (
                    <li key={`${food.name}-${i}`}>
                      <div>
                        <p className="day-food-name">{food.name}</p>
                        <p className="day-food-desc">{food.type} · {food.description}</p>
                      </div>
                      <span className="day-food-price">{food.priceRange}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {day.travelTips?.length > 0 && (
              <section className="day-extra">
                <h5><Lightbulb size={15} /> Good to know</h5>
                <ul className="day-tips">
                  {day.travelTips.map((tip: string, i: number) => <li key={i}>{tip}</li>)}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </article>
  );
};

export default DayCard;
