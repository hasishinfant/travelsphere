/**
 * Pre-book step: confirms availability and the final price with the hotel provider. Continues automatically when
 * nothing changed; otherwise the traveller must accept the new price or terms.
 */

import React, { useState, useEffect, useRef } from 'react';
import Icon from '@/components/shared/Icon';
import { preBookService, PreBookResult } from '../../services/preBookService';
import { HotelBookingSession } from '../../services/hotelBookingService';
import './PreBookStep.css';

// ============================================================================
// Types
// ============================================================================

interface PreBookStepProps {
  session: HotelBookingSession;
  onComplete: (preBookResult: PreBookResult) => void;
  onCancel: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const PreBookStep: React.FC<PreBookStepProps> = ({
  session,
  onComplete,
  onCancel,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preBookResult, setPreBookResult] = useState<PreBookResult | null>(null);
  const [userConfirmed, setUserConfirmed] = useState(false);

  const originalPrice = session.hotel.price.offeredPrice;
  const started = useRef(false);

  // Once per visit: React's development double-mount would otherwise ask the provider for two prebooks
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    performPreBook();
  }, []);

  const performPreBook = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await preBookService.preBook(session.bookingCode, originalPrice);

      setPreBookResult(result);

      // If room is not available, show error (Requirement 3.4)
      if (!result.available) {
        setError('This room is no longer available. Please select another room.');
        return;
      }

      // Nothing changed since the search → continue without asking
      if (!result.priceChanged && !result.cancellationPolicyChanged && !result.boardChanged) {
        onComplete(result);
      }
    } catch (err) {
      setError(
        err instanceof Error 
          ? err.message 
          : 'Failed to validate booking. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmPriceChange = () => {
    if (preBookResult) {
      setUserConfirmed(true);
      onComplete(preBookResult);
    }
  };

  const handleRetry = () => {
    performPreBook();
  };

  // Loading state
  if (loading) {
    return (
      <div className="prebook-step">
        <div className="prebook-loading">
          <div className="loading-spinner" />
          <h3>Verifying Availability and Pricing...</h3>
          <p>Please wait while we confirm your booking details.</p>
        </div>
      </div>
    );
  }

  // Room unavailable state (Requirement 3.4)
  if (preBookResult && !preBookResult.available) {
    return (
      <div className="prebook-step">
        <div className="prebook-unavailable">
          <div className="unavailable-icon"><Icon name="warning" size="xl" /></div>
          <h3>Room No Longer Available</h3>
          <p>
            Unfortunately, this room is no longer available for your selected dates.
            Please return to search results and select another room.
          </p>
          <div className="unavailable-actions">
            <button onClick={onCancel} className="btn-return">
              Return to Search Results
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !preBookResult) {
    return (
      <div className="prebook-step">
        <div className="prebook-error">
          <div className="error-icon"><Icon name="error" size="xl" /></div>
          <h3>Verification Failed</h3>
          <p>{error}</p>
          <div className="error-actions">
            <button onClick={handleRetry} className="btn-retry">
              Try Again
            </button>
            <button onClick={onCancel} className="btn-cancel-secondary">
              Cancel Booking
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Price or terms changed: the traveller must confirm
  if (preBookResult && (preBookResult.priceChanged || preBookResult.cancellationPolicyChanged || preBookResult.boardChanged)) {
    const priceIncreased = preBookResult.priceIncrease > 0;
    const priceMoved = preBookResult.priceIncrease !== 0;

    return (
      <div className="prebook-step">
        <div className={`prebook-price-change ${priceIncreased ? 'increase' : 'decrease'}`}>
          <div className="price-change-icon">
            {priceIncreased ? '⚠️' : '✓'}
          </div>
          
          <h3>
            {!priceMoved ? 'Booking Terms Have Changed' : priceIncreased ? 'Price Has Increased' : 'Price Has Decreased'}
          </h3>

          <p className="price-change-message">
            {!priceMoved
              ? 'The hotel updated the terms for this room. Please review them before continuing.'
              : priceIncreased
                ? 'The room price has increased since your search. Please review the new price below.'
                : 'Good news! The room price has decreased since your search.'}
          </p>

          <div className="price-comparison">
            <div className="price-row original">
              <span className="price-label">Original Price:</span>
              <span className="price-value">
                {preBookResult.currency} {originalPrice.toFixed(2)}
              </span>
            </div>

            <div className="price-row current">
              <span className="price-label">Current Price:</span>
              <span className="price-value">
                {preBookResult.currency} {preBookResult.currentPrice.toFixed(2)}
              </span>
            </div>

            <div className={`price-row difference ${priceIncreased ? 'increase' : 'decrease'}`}>
              <span className="price-label">Difference:</span>
              <span className="price-value">
                {priceIncreased ? '+' : ''}
                {preBookResult.currency} {preBookResult.priceIncrease.toFixed(2)}
              </span>
            </div>
          </div>

          {preBookResult.cancellationPolicyChanged && (
            <div className="policy-change-notice">
              <span className="notice-icon">ℹ️</span>
              <span>Cancellation policy is now: {preBookResult.cancellationPolicy}</span>
            </div>
          )}
          {preBookResult.boardChanged && (
            <div className="policy-change-notice">
              <span className="notice-icon">ℹ️</span>
              <span>The meal plan for this room has changed.</span>
            </div>
          )}

          <div className="hotel-summary">
            <h4>{session.hotel.hotelName}</h4>
            <p>{session.hotel.address}</p>
            <p>
              {session.searchCriteria.checkIn.toLocaleDateString()} - {' '}
              {session.searchCriteria.checkOut.toLocaleDateString()}
            </p>
          </div>

          <div className="price-change-actions">
            <button onClick={onCancel} className="btn-decline">
              Cancel Booking
            </button>
            <button 
              onClick={handleConfirmPriceChange} 
              className="btn-confirm"
              disabled={userConfirmed}
            >
              {!priceMoved ? 'Accept and Continue' : priceIncreased ? 'Accept New Price' : 'Continue with New Price'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Should not reach here as auto-proceed handles no price change
  return null;
};

export default PreBookStep;
