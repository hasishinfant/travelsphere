/**
 * Booking confirmation: reference, hotel, stay, guests, price, cancellation terms and a downloadable voucher.
 */

import React from 'react';
import Icon from '@/components/shared/Icon';
import { HotelBookingConfirmation as BookingConfirmation } from '../../services/hotelBookingService';
import './HotelBookingConfirmation.css';

// ============================================================================
// Types
// ============================================================================

interface HotelBookingConfirmationProps {
  confirmation: BookingConfirmation;
  onViewItinerary?: () => void;
  onNewBooking?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const HotelBookingConfirmation: React.FC<HotelBookingConfirmationProps> = ({
  confirmation,
  onViewItinerary,
  onNewBooking,
}) => {
  const handleDownloadVoucher = () => {
    const blob = new Blob([generateVoucherText(confirmation)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hotel-voucher-${confirmation.confirmationNumber}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const calculateNights = () => {
    const checkIn = new Date(confirmation.checkIn);
    const checkOut = new Date(confirmation.checkOut);
    const diffTime = Math.abs(checkOut.getTime() - checkIn.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const nights = calculateNights();

  return (
    <div className="hotel-booking-confirmation">
      {/* Success Header */}
      <div className="confirmation-header">
        <div className="success-icon">✓</div>
        <h2>Booking Confirmed!</h2>
        <p>Your hotel reservation has been successfully completed</p>
      </div>

      {confirmation.sandbox && (
        <div className="sandbox-notice" role="note">
          <Icon name="info" size="sm" /> Test booking (provider sandbox): no reservation was made at the hotel and nothing was charged.
        </div>
      )}

      {/* Confirmation Number */}
      <div className="confirmation-number-section">
        <div className="confirmation-number-card">
          <span className="label">Confirmation Number</span>
          <span className="number">{confirmation.confirmationNumber}</span>
        </div>
      </div>

      {/* Hotel Details */}
      <div className="confirmation-section">
        <h3>Hotel Details</h3>
        <div className="hotel-info-card">
          <div className="hotel-name">{confirmation.hotelName}</div>
          <div className="hotel-rating">
            {'★'.repeat(confirmation.hotel.starRating)}
            {'☆'.repeat(5 - confirmation.hotel.starRating)}
          </div>
          <div className="hotel-address">{confirmation.hotel.address}</div>
          <div className="hotel-location">
            {confirmation.hotel.cityName}, {confirmation.hotel.countryName}
          </div>
        </div>
      </div>

      {/* Stay Details */}
      <div className="confirmation-section">
        <h3>Stay Details</h3>
        <div className="stay-details-grid">
          <div className="detail-item">
            <span className="detail-label">Check-in</span>
            <span className="detail-value">
              {confirmation.checkIn.toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Check-out</span>
            <span className="detail-value">
              {confirmation.checkOut.toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Duration</span>
            <span className="detail-value">
              {nights} {nights === 1 ? 'Night' : 'Nights'}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Rooms</span>
            <span className="detail-value">
              {confirmation.guestDetails.length} {confirmation.guestDetails.length === 1 ? 'Room' : 'Rooms'}
            </span>
          </div>
        </div>
      </div>

      {/* Guest Details */}
      <div className="confirmation-section">
        <h3>Guest Information</h3>
        {confirmation.guestDetails.map((room, index) => (
          <div key={index} className="guest-room-card">
            <h4>Room {index + 1}</h4>
            <div className="guests-list">
              {room.customerNames.map((guest, guestIndex) => (
                <div key={guestIndex} className="guest-item">
                  <span className="guest-type">{guest.type}:</span>
                  <span className="guest-name">
                    {guest.title} {guest.firstName} {guest.lastName}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Payment Summary */}
      <div className="confirmation-section">
        <h3>Payment Summary</h3>
        <div className="payment-summary-card">
          <div className="payment-row">
            <span className="payment-label">{confirmation.sandbox ? 'Total Amount' : 'Total Amount Paid'}</span>
            <span className="payment-value">
              {confirmation.currency} {confirmation.totalFare.toFixed(2)}
            </span>
          </div>
          <div className="payment-row">
            <span className="payment-label">Booking Status</span>
            <span className="status-badge confirmed">{confirmation.status}</span>
          </div>
          <div className="payment-row">
            <span className="payment-label">Booked On</span>
            <span className="payment-value">
              {confirmation.bookedAt.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Voucher Actions */}
      <div className="voucher-actions">
        <h3>Booking Voucher</h3>
        <p className="voucher-description">
          Download your booking voucher for your records
        </p>
        <div className="voucher-buttons">
          <button onClick={handleDownloadVoucher} className="btn-download">
            <span className="btn-icon">⬇</span>
            Download Voucher
          </button>
        </div>
      </div>

      {/* Itinerary Integration */}
      <div className="itinerary-integration">
        <div className="integration-icon"><Icon name="calendar" size="lg" /></div>
        <div className="integration-content">
          <h4>Added to Your Itinerary</h4>
          <p>
            This hotel booking has been automatically added to your TravelSphere itinerary.
            View your complete travel plans anytime.
          </p>
        </div>
        {onViewItinerary && (
          <button onClick={onViewItinerary} className="btn-view-itinerary">
            View Itinerary
          </button>
        )}
      </div>

      {/* Next Steps */}
      <div className="next-steps">
        <h3>What's Next?</h3>
        <ul className="steps-list">
          <li>Present your confirmation number at hotel check-in</li>
          <li>Cancellation: {confirmation.cancellationPolicy || 'see your booking details'}</li>
          <li>Manage or cancel this booking under “Your hotel bookings” on the Hotels page</li>
        </ul>
      </div>

      {/* Action Buttons */}
      <div className="confirmation-actions">
        {onNewBooking && (
          <button onClick={onNewBooking} className="btn-new-booking">
            Book Another Hotel
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Helper Functions
// ============================================================================

function generateVoucherText(confirmation: BookingConfirmation): string {
  return `
HOTEL BOOKING VOUCHER
=====================

Confirmation Number: ${confirmation.confirmationNumber}${confirmation.sandbox ? '\nTEST BOOKING (sandbox) — not a real reservation' : ''}

HOTEL DETAILS
-------------
${confirmation.hotelName}
${confirmation.hotel.address}
${confirmation.hotel.cityName}, ${confirmation.hotel.countryName}
Rating: ${'★'.repeat(confirmation.hotel.starRating)}

STAY DETAILS
------------
Check-in: ${confirmation.checkIn.toLocaleDateString()}
Check-out: ${confirmation.checkOut.toLocaleDateString()}
Rooms: ${confirmation.guestDetails.length}

GUEST INFORMATION
-----------------
${confirmation.guestDetails.map((room, index) => `
Room ${index + 1}:
${room.customerNames.map(guest => `  - ${guest.title} ${guest.firstName} ${guest.lastName} (${guest.type})`).join('\n')}
`).join('\n')}

PAYMENT SUMMARY
---------------
Total Amount: ${confirmation.currency} ${confirmation.totalFare.toFixed(2)}
Status: ${confirmation.status}
Cancellation: ${confirmation.cancellationPolicy}
Booked On: ${confirmation.bookedAt.toLocaleString()}

Please present this voucher at check-in.
For any queries, contact the hotel directly or TravelSphere support.
  `.trim();
}

export default HotelBookingConfirmation;
