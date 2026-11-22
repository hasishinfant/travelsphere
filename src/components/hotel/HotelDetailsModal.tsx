/**
 * Hotel details modal: photos, description, facilities, check-in/out times and a choice of rooms.
 * "Book now" continues with the selected room's offer.
 */

import React, { useState, useEffect } from 'react';
import Icon from '@/components/shared/Icon';
import { getHotelDetailsService, type HotelDetailsResult } from '../../services/hotelDetailsService';
import type { HotelResult } from '../../services/hotelSearchService';
import type { HotelOffer } from '../../services/hotelApi';
import './HotelDetailsModal.css';

/** The hotel result with the chosen room's offer applied. */
export const withOffer = (hotel: HotelResult, offer: HotelOffer): HotelResult => ({
  ...hotel,
  bookingCode: offer.offerId,
  roomType: offer.roomName,
  mealType: offer.boardName,
  refundable: offer.refundable,
  cancellationPolicy: offer.cancellation,
  price: { currency: offer.currency, offeredPrice: offer.price, publishedPrice: offer.price, discount: 0 },
});

interface HotelDetailsModalProps {
  hotel: HotelResult;
  isOpen: boolean;
  onClose: () => void;
  onBookNow?: (hotel: HotelResult) => void;
}

const HotelDetailsModal: React.FC<HotelDetailsModalProps> = ({
  hotel,
  isOpen,
  onClose,
  onBookNow,
}) => {
  const hotelDetailsService = getHotelDetailsService();
  
  const [hotelDetails, setHotelDetails] = useState<HotelDetailsResult | null>(null);
  const [offerId, setOfferId] = useState(hotel.bookingCode);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    if (isOpen && hotel) {
      loadHotelDetails();
    }
  }, [isOpen, hotel]);

  const loadHotelDetails = async () => {
    setIsLoading(true);
    setError(null);

    try {
      setHotelDetails(await hotelDetailsService.getHotelDetails(hotel.hotelCode));
    } catch (err) {
      console.error('Failed to load hotel details:', err);
      setError('Unable to load hotel details. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const offers = hotel.offers.length ? hotel.offers : [];
  const selected = offers.find(o => o.offerId === offerId) ?? offers[0];

  const handleBookNow = () => {
    onBookNow?.(selected ? withOffer(hotel, selected) : hotel);
  };

  const images = hotelDetails?.images.length ? hotelDetails.images : hotel.hotelImages;

  const handlePrevImage = () => {
    setCurrentImageIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const handleNextImage = () => {
    setCurrentImageIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  if (!isOpen) return null;

  const currentImage = images[currentImageIndex];
  const price = selected ? { currency: selected.currency, amount: selected.price } : { currency: hotel.price.currency, amount: hotel.price.offeredPrice };

  return (
    <div className="hotel-details-modal-overlay" onClick={handleBackdropClick}>
      <div className="hotel-details-modal">
        {/* Close Button */}
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>

        {/* Image Gallery */}
        <div className="modal-image-gallery">
          {currentImage
            ? <img src={currentImage} alt={hotel.hotelName} />
            : <div className="gallery-empty"><Icon name="hotel" size="xl" /></div>}
          
          {images.length > 1 && (
            <>
              <button
                className="gallery-nav-btn prev"
                onClick={handlePrevImage}
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                className="gallery-nav-btn next"
                onClick={handleNextImage}
                aria-label="Next image"
              >
                ›
              </button>
              <div className="gallery-indicators">
                {images.map((_, index) => (
                  <button
                    key={index}
                    className={`indicator ${index === currentImageIndex ? 'active' : ''}`}
                    onClick={() => setCurrentImageIndex(index)}
                    aria-label={`View image ${index + 1}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Modal Content */}
        <div className="modal-content">
          {/* Header */}
          <div className="modal-header">
            <div className="hotel-title-section">
              <h2>{hotel.hotelName}</h2>
              <div className="star-rating">
                {Array.from({ length: hotel.starRating }, (_, i) => (
                  <span key={i} className="star">★</span>
                ))}
              </div>
            </div>
            <p className="hotel-address">
              <Icon name="location" size="xs" /> {[hotelDetails?.address || hotel.address, hotel.cityName, hotel.countryName].filter(Boolean).join(', ')}
            </p>
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="loading-section">
              <div className="loading-spinner"></div>
              <p>Loading hotel details...</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="error-section">
              <span className="error-icon"><Icon name="warning" size="sm" /></span>
              <p>{error}</p>
            </div>
          )}

          {/* Hotel Details */}
          {!isLoading && !error && (
            <>
              {/* Description */}
              {hotelDetails?.description && (
                <section className="details-section">
                  <h3>About This Hotel</h3>
                  <p className="hotel-description">{hotelDetails.description}</p>
                </section>
              )}

              {/* Amenities */}
              {hotelDetails && hotelDetails.facilities.length > 0 && (
                <section className="details-section">
                  <h3>Amenities & Facilities</h3>
                  <div className="amenities-grid">
                    {hotelDetails.facilities.map((amenity, index) => (
                      <div key={index} className="amenity-item">
                        <span className="amenity-icon">✓</span>
                        <span>{amenity}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Hotel Policy */}
              {hotelDetails && (hotelDetails.policy.checkInTime || hotelDetails.policy.checkOutTime || hotelDetails.importantInformation) && (
                <section className="details-section">
                  <h3>Hotel Policies</h3>
                  <div className="policy-grid">
                    {hotelDetails.policy.checkInTime && (
                      <div className="policy-item">
                        <span className="policy-icon"><Icon name="clock" size="sm" /></span>
                        <div className="policy-content">
                          <strong>Check-in from:</strong>
                          <p>{hotelDetails.policy.checkInTime}</p>
                        </div>
                      </div>
                    )}
                    {hotelDetails.policy.checkOutTime && (
                      <div className="policy-item">
                        <span className="policy-icon"><Icon name="clock" size="sm" /></span>
                        <div className="policy-content">
                          <strong>Check-out by:</strong>
                          <p>{hotelDetails.policy.checkOutTime}</p>
                        </div>
                      </div>
                    )}
                    {hotelDetails.importantInformation && (
                      <div className="policy-item full-width">
                        <span className="policy-icon"><Icon name="clipboard" size="sm" /></span>
                        <div className="policy-content">
                          <strong>Important information:</strong>
                          <p>{hotelDetails.importantInformation}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Location */}
              {hotelDetails?.location && (
                <section className="details-section">
                  <h3>Location</h3>
                  <div className="map-info">
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${hotelDetails.location.latitude}&mlon=${hotelDetails.location.longitude}#map=16/${hotelDetails.location.latitude}/${hotelDetails.location.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View on map ({hotelDetails.location.latitude.toFixed(4)}, {hotelDetails.location.longitude.toFixed(4)})
                    </a>
                  </div>
                </section>
              )}
            </>
          )}

            {/* Rooms (from the search — available even if details fail to load) */}
            <section className="details-section">
              <h3>Choose a Room</h3>
              <div className="offer-list" role="radiogroup" aria-label="Available rooms">
                {offers.map(o => (
                  <label key={o.offerId} className={`offer-option ${o.offerId === selected?.offerId ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="offer"
                      value={o.offerId}
                      checked={o.offerId === selected?.offerId}
                      onChange={() => setOfferId(o.offerId)}
                    />
                    <span className="offer-main">
                      <strong>{o.roomName}</strong>
                      <span>{o.boardName}</span>
                      <span className={o.refundable ? 'refundable' : 'non-refundable'}>{o.cancellation}</span>
                    </span>
                    <span className="offer-price">{o.currency} {o.price.toFixed(2)}</span>
                  </label>
                ))}
              </div>
            </section>

          {/* Pricing and Booking */}
          <div className="modal-footer">
            <div className="price-section">
              <div className="price-details">
                <div className="current-price">
                  <span className="currency">{price.currency}</span>
                  <span className="amount">{price.amount.toFixed(2)}</span>
                </div>
                <span className="price-label">total for {hotel.nights} night{hotel.nights === 1 ? '' : 's'}</span>
              </div>
            </div>

            <button className="btn-book-now" onClick={handleBookNow} disabled={!selected}>
              Book Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HotelDetailsModal;
