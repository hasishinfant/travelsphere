/**
 * Hotel Search Results Component
 * 
 * Displays hotel search results with:
 * - Hotel cards in grid layout
 * - Filter controls (refundable, star rating, meal type)
 * - Hotel details (name, location, price, amenities)
 * - Empty results and mock mode indication
 * 
 * Requirements: 1.3, 1.4, 8.3
 */

import React, { Suspense, lazy, useState, useMemo } from 'react';
import Icon from '@/components/shared/Icon';
import { getHotelSearchService } from '../../services/hotelSearchService';
import type { HotelResult, HotelSearchFilters, HotelSearchResult, MealPlan } from '../../services/hotelSearchService';
import './HotelSearchResults.css';
import './HotelMap.css';

const HotelMap = lazy(() => import('./HotelMap'));
const MAP_PREF = 'hotel_results_map';
const readMapPref = () => { try { return localStorage.getItem(MAP_PREF) !== 'hidden'; } catch { return true; } };

interface HotelSearchResultsProps {
  searchResult: HotelSearchResult;
  onHotelSelect?: (hotel: HotelResult) => void;
}

const HotelSearchResults: React.FC<HotelSearchResultsProps> = ({
  searchResult,
  onHotelSelect,
}) => {
  const hotelSearchService = getHotelSearchService();
  
  // Filter state
  const [filters, setFilters] = useState<HotelSearchFilters>({});
  const [sortBy, setSortBy] = useState<'price' | 'rating' | 'name'>('price');
  const [showMap, setShowMap] = useState(readMapPref);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const toggleMap = () => setShowMap(v => {
    try { localStorage.setItem(MAP_PREF, v ? 'hidden' : 'shown'); } catch { /* preference only */ }
    return !v;
  });

  // Apply filters and sorting
  const filteredAndSortedHotels = useMemo(() => {
    // Apply filters
    let filtered = hotelSearchService.filterResults(searchResult.hotels, filters);

    // Apply sorting
    filtered = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'price':
          return a.price.offeredPrice - b.price.offeredPrice;
        case 'rating':
          return b.starRating - a.starRating;
        case 'name':
          return a.hotelName.localeCompare(b.hotelName);
        default:
          return 0;
      }
    });

    return filtered;
  }, [searchResult.hotels, filters, sortBy, hotelSearchService]);

  const handleFilterChange = (filterKey: keyof HotelSearchFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [filterKey]: value === '' || value === undefined ? undefined : value,
    }));
  };

  const handleClearFilters = () => {
    setFilters({});
  };

  const hasActiveFilters = Object.keys(filters).some(
    key => filters[key as keyof HotelSearchFilters] !== undefined
  );
  const onMap = filteredAndSortedHotels.filter(h => h.latitude != null && h.longitude != null).length;

  return (
    <div className="hotel-search-results">
      {/* Sandbox indicator */}
      {searchResult.sandbox && (
        <div className="mock-mode-banner">
          <span className="mock-icon"><Icon name="info" size="sm" /></span>
          <div className="mock-text">
            <strong>Test mode:</strong> live hotels and prices from the provider sandbox. Bookings are simulated and nothing is charged.
          </div>
        </div>
      )}

      {/* Results Header */}
      <div className="results-header">
        <h2>
          {filteredAndSortedHotels.length} {filteredAndSortedHotels.length === 1 ? 'Hotel' : 'Hotels'} Found
        </h2>
        <p className="search-summary">
          in {searchResult.searchCriteria.city}, {searchResult.searchCriteria.countryCode}
        </p>
        {searchResult.hotels.length > 0 && (
          <button type="button" className="results-map-toggle" onClick={toggleMap} aria-pressed={showMap}>
            <Icon name="map" size="sm" /> {showMap ? 'Hide map' : 'Show map'}
          </button>
        )}
      </div>

      {showMap && searchResult.hotels.length > 0 && (
        <>
          <Suspense fallback={<div className="hotel-map" aria-busy="true" />}>
            <HotelMap hotels={filteredAndSortedHotels} activeCode={activeCode}
              onActiveChange={setActiveCode} onSelect={h => onHotelSelect?.(h)} />
          </Suspense>
          {onMap < filteredAndSortedHotels.length && (
            <p className="hotel-map-note">
              {onMap} of {filteredAndSortedHotels.length} hotels shown on the map; the others have no location from the provider.
            </p>
          )}
        </>
      )}

      {/* Filters and Sort */}
      <div className="filters-section">
        <div className="filters-row">
          {/* Star Rating Filter */}
          <div className="filter-group">
            <label htmlFor="starRating">Star Rating</label>
            <select
              id="starRating"
              value={filters.starRating || ''}
              onChange={(e) => handleFilterChange('starRating', e.target.value ? parseInt(e.target.value) : undefined)}
            >
              <option value="">All Ratings</option>
              <option value="5">5 Stars</option>
              <option value="4">4 Stars</option>
              <option value="3">3 Stars</option>
            </select>
          </div>

          {/* Refundable Filter */}
          <div className="filter-group">
            <label htmlFor="refundable">Cancellation</label>
            <select
              id="refundable"
              value={filters.refundable === undefined ? '' : filters.refundable ? 'true' : 'false'}
              onChange={(e) => handleFilterChange('refundable', e.target.value === '' ? undefined : e.target.value === 'true')}
            >
              <option value="">All Hotels</option>
              <option value="true">Refundable Only</option>
              <option value="false">Non-Refundable</option>
            </select>
          </div>

          {/* Meal Type Filter */}
          <div className="filter-group">
            <label htmlFor="mealType">Meal Plan</label>
            <select
              id="mealType"
              value={filters.mealPlan || ''}
              onChange={(e) => handleFilterChange('mealPlan', (e.target.value || undefined) as MealPlan | undefined)}
            >
              <option value="">All Meal Plans</option>
              <option value="room_only">Room Only</option>
              <option value="breakfast">Breakfast Included</option>
              <option value="half_board">Half Board</option>
              <option value="full_board">Full Board</option>
              <option value="all_inclusive">All Inclusive</option>
            </select>
          </div>

          {/* Sort By */}
          <div className="filter-group">
            <label htmlFor="sortBy">Sort By</label>
            <select
              id="sortBy"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'price' | 'rating' | 'name')}
            >
              <option value="price">Price (Low to High)</option>
              <option value="rating">Star Rating (High to Low)</option>
              <option value="name">Name (A-Z)</option>
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <button onClick={handleClearFilters} className="btn-clear-filters">
            Clear All Filters
          </button>
        )}
      </div>

      {/* Results Grid */}
      {filteredAndSortedHotels.length > 0 ? (
        <div className="hotels-grid">
          {filteredAndSortedHotels.map((hotel) => (
            <HotelCard
              key={hotel.bookingCode}
              hotel={hotel}
              active={showMap && activeCode === hotel.hotelCode}
              onHover={on => setActiveCode(on ? hotel.hotelCode : null)}
              onSelect={() => onHotelSelect?.(hotel)}
            />
          ))}
        </div>
      ) : (
        <div className="no-results">
          <div className="no-results-icon"><Icon name="hotel" size="xl" /></div>
          <h3>No Hotels Found</h3>
          <p>Try adjusting your filters or search criteria</p>
          {hasActiveFilters && (
            <button onClick={handleClearFilters} className="btn primary">
              Clear Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Hotel Card Component
interface HotelCardProps {
  hotel: HotelResult;
  active?: boolean;
  onHover?: (on: boolean) => void;
  onSelect: () => void;
}

const HotelCard: React.FC<HotelCardProps> = ({ hotel, active, onHover, onSelect }) => {
  return (
    <div className={`hotel-card${active ? ' is-active' : ''}`}
      onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)} onBlur={() => onHover?.(false)}>
      {/* Hotel Image */}
      <div className="hotel-image">
        {hotel.hotelPicture
          ? <img src={hotel.hotelPicture} alt={hotel.hotelName} loading="lazy" decoding="async" />
          : <div className="hotel-image-empty"><Icon name="hotel" size="xl" /></div>}
        {hotel.refundable && (
          <span className="refundable-badge">Free Cancellation</span>
        )}
      </div>

      {/* Hotel Info */}
      <div className="hotel-info">
        <div className="hotel-header">
          <h3 className="hotel-name">{hotel.hotelName}</h3>
          <div className="star-rating">
            {Array.from({ length: hotel.starRating }, (_, i) => (
              <span key={i} className="star">★</span>
            ))}
          </div>
        </div>

        <p className="hotel-location">
          <Icon name="location" size="xs" /> {[hotel.address, hotel.cityName].filter(Boolean).join(', ')}
        </p>

        <div className="hotel-details">
          <span className="room-type">{hotel.roomType}</span>
          <span className="meal-type"><Icon name="food" size="xs" /> {hotel.mealType}</span>
        </div>

        {/* Amenities */}
        {hotel.amenities.length > 0 && (
          <div className="amenities">
            {hotel.amenities.slice(0, 4).map((amenity, index) => (
              <span key={index} className="amenity-tag">
                {amenity}
              </span>
            ))}
            {hotel.amenities.length > 4 && (
              <span className="amenity-tag more">
                +{hotel.amenities.length - 4} more
              </span>
            )}
          </div>
        )}

        {/* Pricing */}
        <div className="hotel-pricing">
          <div className="price-info">
            {hotel.price.discount > 0 && (
              <span className="original-price">
                {hotel.price.currency} {hotel.price.publishedPrice.toFixed(2)}
              </span>
            )}
            <div className="current-price">
              <span className="currency">{hotel.price.currency}</span>
              <span className="amount">{hotel.price.offeredPrice.toFixed(2)}</span>
            </div>
            <span className="price-label">total, {hotel.nights} night{hotel.nights === 1 ? '' : 's'}</span>
          </div>

          <button onClick={onSelect} className="btn-select">
            View Details
          </button>
        </div>

        {hotel.offers.length > 1 && (
          <div className="availability-note">{hotel.offers.length} room options</div>
        )}
      </div>
    </div>
  );
};

export default HotelSearchResults;
