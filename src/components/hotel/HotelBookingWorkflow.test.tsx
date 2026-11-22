/**
 * Booking workflow end to end with the real step components and services; only the HTTP client is mocked.
 * Details → Verify pricing → Guest details → Review & confirm → Confirmation.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../services/apiClient', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/apiClient')>()), api,
}));

import HotelBookingWorkflow from './HotelBookingWorkflow';
import { hotelBookingService } from '../../services/hotelBookingService';
import { criteria, hotelResult } from '../../tests/hotelFixtures';
import { ApiError } from '../../services/apiClient';

const prebook = (over = {}) => ({ prebook: { prebookId: 'pb-1', offerId: 'offer-cheap', hotelId: 'lp1897', price: 180.5,
  currency: 'EUR', priceDifferencePercent: 0, cancellationChanged: false, boardChanged: false, refundable: false,
  cancellation: 'Non-refundable', ...over } });
const booked = { recorded: true, booking: { booking_id: 'V8mglw-im', hotel_name: 'Hotel Lumière', price: '180.50',
  currency: 'EUR', status: 'CONFIRMED', sandbox: true } };

const start = (sandbox = true) => {
  const s = hotelBookingService.startBooking(hotelResult(), criteria());
  const props = { onComplete: vi.fn(), onCancel: vi.fn() };
  render(<HotelBookingWorkflow session={s} sandbox={sandbox} {...props} />);
  return props;
};

const fillGuests = () => {
  ['room0_guest0', 'room0_guest1'].forEach((g, i) => {
    fireEvent.change(document.getElementById(`${g}_title`)!, { target: { value: i ? 'Mr' : 'Ms' } });
    fireEvent.change(document.getElementById(`${g}_firstName`)!, { target: { value: i ? 'Ravi' : 'Asha' } });
    fireEvent.change(document.getElementById(`${g}_lastName`)!, { target: { value: 'Rao' } });
  });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'asha@example.test' } });
  fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '+91 98765 43210' } });
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
};

beforeEach(() => {
  api.mockReset();
  localStorage.clear();
  hotelBookingService.cancelSession();
});

describe('HotelBookingWorkflow', () => {
  it('shows the stay summary on the first step', () => {
    start();
    expect(screen.getByRole('heading', { name: 'Hotel Lumière' })).toBeInTheDocument();
    expect(screen.getByText('Standard King Room')).toBeInTheDocument();
    expect(screen.getByText('2 nights, 1 room, 2 guests')).toBeInTheDocument();
    expect(screen.getByText('EUR 180.50')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
  });

  it('completes a sandbox booking through every step', async () => {
    api.mockImplementation(async (path: string) => (path === '/v1/hotels/prebook' ? prebook() : booked));
    const { onComplete } = start();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Guest Details' });          // price unchanged → continues automatically
    fillGuests();

    expect(await screen.findByText(/Test mode: this booking uses the hotel provider sandbox/)).toBeInTheDocument();
    expect(screen.getByText(/asha@example.test/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm booking · EUR 180.50/i }));

    expect(await screen.findByText('Booking Confirmed!')).toBeInTheDocument();
    expect(screen.getByText('V8mglw-im')).toBeInTheDocument();
    expect(screen.getByText(/no reservation was made at the hotel/)).toBeInTheDocument();
    const book = api.mock.calls.find(c => c[0] === '/v1/hotels/book')!;
    expect(book[1].body).toMatchObject({ prebook_id: 'pb-1', holder: { first_name: 'Asha', email: 'asha@example.test' } });

    fireEvent.click(screen.getByRole('button', { name: /view itinerary/i }));
    expect(onComplete).toHaveBeenCalledWith('V8mglw-im');
  });

  it('keeps the traveller on the review step with the error when booking fails', async () => {
    api.mockImplementation(async (path: string) => {
      if (path === '/v1/hotels/prebook') return prebook();
      throw new ApiError(410, 'offer_expired', 'This room is no longer available at this price — search again');
    });
    start();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Guest Details' });
    fillGuests();
    fireEvent.click(await screen.findByRole('button', { name: /confirm booking/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.getByRole('button', { name: /confirm booking/i })).toBeEnabled();
  });

  it('warns that a live booking creates a real reservation', async () => {
    api.mockImplementation(async () => prebook());
    start(false);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Guest Details' });
    fillGuests();
    expect(await screen.findByText(/creates a real reservation/)).toBeInTheDocument();
  });

  it('cancels the session', () => {
    const { onCancel } = start();
    fireEvent.click(screen.getByRole('button', { name: /cancel booking/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(hotelBookingService.getCurrentSession()).toBeNull();
  });
});
