/**
 * Hotel booking workflow: Details → Verify pricing → Guest details → Review & confirm → Confirmation.
 * Progress is kept in the booking session, so a page reload resumes where the traveller left off.
 */

import React, { useEffect, useState } from 'react';
import Icon from '@/components/shared/Icon';
import {
  hotelBookingService,
  type GuestDetails,
  type HotelBookingConfirmation as Confirmation,
  type HotelBookingSession,
  type PaymentInfo,
} from '../../services/hotelBookingService';
import type { PreBookResult } from '../../services/preBookService';
import PreBookStep from './PreBookStep';
import GuestDetailsForm from './GuestDetailsForm';
import HotelBookingConfirmation from './HotelBookingConfirmation';
import './HotelBookingWorkflow.css';

export type WorkflowStep = 'details' | 'prebook' | 'guest_details' | 'payment' | 'confirmed';

interface HotelBookingWorkflowProps {
  session: HotelBookingSession;
  /** Whether results came from the provider sandbox (test bookings, nothing charged). */
  sandbox?: boolean;
  onComplete?: (confirmationNumber: string) => void;
  onCancel?: () => void;
}

const STEPS: { key: WorkflowStep; label: string }[] = [
  { key: 'details', label: 'Hotel Details' },
  { key: 'prebook', label: 'Verify Pricing' },
  { key: 'guest_details', label: 'Guest Details' },
  { key: 'payment', label: 'Review & Confirm' },
  { key: 'confirmed', label: 'Confirmation' },
];

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const money = (currency: string, amount: number) => `${currency} ${amount.toFixed(2)}`;

export const HotelBookingWorkflow: React.FC<HotelBookingWorkflowProps> = ({
  session: initialSession,
  sandbox = true,
  onComplete,
  onCancel,
}) => {
  const [session, setSession] = useState<HotelBookingSession>(initialSession);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>(initialSession.status);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  // Persist progress
  useEffect(() => {
    try {
      hotelBookingService.updateSession({ status: currentStep });
    } catch {
      // expired session: the page will return to search
    }
  }, [currentStep]);

  const stepIndex = STEPS.findIndex(s => s.key === currentStep);
  const { hotel, searchCriteria } = session;
  const nights = Math.round((searchCriteria.checkOut.getTime() - searchCriteria.checkIn.getTime()) / 86_400_000);
  const guests = searchCriteria.paxRooms.reduce((n, r) => n + r.adults + r.children, 0);

  const save = (data: Partial<HotelBookingSession>, next: WorkflowStep) => {
    hotelBookingService.updateSession(data);
    const updated = hotelBookingService.getCurrentSession();
    if (updated) setSession(updated);
    setCurrentStep(next);
  };

  const handleCancel = () => {
    hotelBookingService.cancelSession();
    onCancel?.();
  };

  const handlePreBooked = (result: PreBookResult) => save({ preBookResult: result }, 'guest_details');

  const handleGuests = (guestDetails: GuestDetails[], paymentInfo: PaymentInfo) =>
    save({ guestDetails, paymentInfo }, 'payment');

  const handleConfirm = async () => {
    if (!session.guestDetails || !session.paymentInfo) return;
    setBooking(true);
    setBookError(null);
    try {
      const confirmation: Confirmation = await hotelBookingService.completeBooking(session.guestDetails, session.paymentInfo);
      setSession({ ...session, confirmation, status: 'confirmed' });
      setCurrentStep('confirmed');
    } catch (err) {
      setBookError(err instanceof Error ? err.message : 'The booking could not be completed. Please try again.');
    } finally {
      setBooking(false);
    }
  };

  const price = session.preBookResult?.available
    ? money(session.preBookResult.currency, session.preBookResult.currentPrice)
    : money(hotel.price.currency, hotel.price.offeredPrice);

  const summary = (
    <div className="step-summary">
      <h3>{hotel.hotelName}</h3>
      <p className="summary-address">
        <Icon name="location" size="xs" /> {[hotel.address, hotel.cityName, hotel.countryName].filter(Boolean).join(', ')}
      </p>
      <dl className="summary-grid">
        <div><dt>Room</dt><dd>{hotel.roomType}</dd></div>
        <div><dt>Meal plan</dt><dd>{hotel.mealType}</dd></div>
        <div><dt>Check-in</dt><dd>{fmtDate(searchCriteria.checkIn)}</dd></div>
        <div><dt>Check-out</dt><dd>{fmtDate(searchCriteria.checkOut)}</dd></div>
        <div><dt>Stay</dt><dd>{nights} night{nights === 1 ? '' : 's'}, {searchCriteria.paxRooms.length} room{searchCriteria.paxRooms.length === 1 ? '' : 's'}, {guests} guest{guests === 1 ? '' : 's'}</dd></div>
        <div><dt>Cancellation</dt><dd>{session.preBookResult?.cancellationPolicy || hotel.cancellationPolicy}</dd></div>
        <div className="summary-total"><dt>Total</dt><dd>{price}</dd></div>
      </dl>
    </div>
  );

  return (
    <div className="hotel-booking-workflow">
      <div className="workflow-progress">
        <div className="progress-steps">
          {STEPS.map((step, index) => (
            <div
              key={step.key}
              className={`progress-step ${index < stepIndex ? 'completed' : index === stepIndex ? 'active' : 'pending'}`}
            >
              <div className="step-indicator">
                {index < stepIndex ? <span className="step-check">✓</span> : <span className="step-number">{index + 1}</span>}
              </div>
              <div className="step-label">{step.label}</div>
              {index < STEPS.length - 1 && <div className="step-connector" />}
            </div>
          ))}
        </div>
      </div>

      <div className="workflow-content">
        {currentStep === 'details' && summary}

        {currentStep === 'prebook' && (
          <PreBookStep session={session} onComplete={handlePreBooked} onCancel={handleCancel} />
        )}

        {currentStep === 'guest_details' && (
          <GuestDetailsForm session={session} onSubmit={handleGuests} onBack={() => setCurrentStep('details')} />
        )}

        {currentStep === 'payment' && (
          <>
            {summary}
            <div className={`payment-notice ${sandbox ? 'sandbox' : 'live'}`} role="note">
              <Icon name="info" size="sm" />
              {sandbox
                ? 'Test mode: this booking uses the hotel provider sandbox. No reservation is made at the hotel and nothing is charged.'
                : 'Confirming creates a real reservation at the hotel for the total shown.'}
            </div>
            {session.paymentInfo && (
              <p className="contact-line">Confirmation details go to {session.paymentInfo.emailId} · {session.paymentInfo.phoneNumber}</p>
            )}
            {bookError && <div className="error-message" role="alert"><Icon name="warning" size="sm" /> {bookError}</div>}
          </>
        )}

        {currentStep === 'confirmed' && session.confirmation && (
          <HotelBookingConfirmation
            confirmation={session.confirmation}
            onViewItinerary={() => onComplete?.(session.confirmation!.confirmationNumber)}
            onNewBooking={handleCancel}
          />
        )}
      </div>

      {currentStep !== 'confirmed' && (
        <div className="workflow-actions">
          <button type="button" onClick={handleCancel} className="btn-cancel" disabled={booking}>
            Cancel Booking
          </button>
          <div className="workflow-nav-buttons">
            {currentStep === 'payment' && (
              <button type="button" onClick={() => setCurrentStep('guest_details')} className="btn-back" disabled={booking}>
                Back
              </button>
            )}
            {currentStep === 'details' && (
              <button type="button" onClick={() => setCurrentStep('prebook')} className="btn-next">
                Continue
              </button>
            )}
            {currentStep === 'payment' && (
              <button type="button" onClick={handleConfirm} className="btn-next" disabled={booking}>
                {booking ? 'Booking…' : `Confirm Booking · ${price}`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HotelBookingWorkflow;
