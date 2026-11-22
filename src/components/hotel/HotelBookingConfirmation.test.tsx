import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import HotelBookingConfirmation from './HotelBookingConfirmation';
import type { HotelBookingConfirmation as Confirmation } from '../../services/hotelBookingService';
import { criteria, hotelResult } from '../../tests/hotelFixtures';

const confirmation = (over: Partial<Confirmation> = {}): Confirmation => ({
  confirmationNumber: 'V8mglw-im',
  bookingReferenceId: 'V8mglw-im',
  hotel: hotelResult(),
  hotelName: 'Hotel Lumière',
  guestDetails: [{ roomIndex: 0, customerNames: [{ title: 'Ms', firstName: 'Asha', lastName: 'Rao', type: 'Adult' }] }],
  totalFare: 180.5,
  currency: 'EUR',
  checkIn: criteria().checkIn,
  checkOut: criteria().checkOut,
  bookedAt: new Date(),
  status: 'CONFIRMED',
  sandbox: true,
  cancellationPolicy: 'Non-refundable',
  ...over,
});

describe('HotelBookingConfirmation', () => {
  it('shows the booking, hotel, guests and terms', () => {
    render(<HotelBookingConfirmation confirmation={confirmation()} />);
    expect(screen.getByText('V8mglw-im')).toBeInTheDocument();
    expect(screen.getByText('Hotel Lumière')).toBeInTheDocument();
    expect(screen.getByText('12 Rue de Rivoli')).toBeInTheDocument();
    expect(screen.getByText('★★★★☆')).toBeInTheDocument();
    expect(screen.getByText(/Ms Asha Rao/)).toBeInTheDocument();
    expect(screen.getByText('EUR 180.50')).toBeInTheDocument();
    expect(screen.getByText('Cancellation: Non-refundable')).toBeInTheDocument();
  });

  it('marks sandbox bookings as tests and never claims payment', () => {
    const { rerender } = render(<HotelBookingConfirmation confirmation={confirmation()} />);
    expect(screen.getByRole('note')).toHaveTextContent('nothing was charged');
    expect(screen.getByText('Total Amount')).toBeInTheDocument();
    rerender(<HotelBookingConfirmation confirmation={confirmation({ sandbox: false })} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByText('Total Amount Paid')).toBeInTheDocument();
  });

  it('downloads a voucher and offers no simulated email', () => {
    const createObjectURL = vi.fn(() => 'blob:voucher');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    render(<HotelBookingConfirmation confirmation={confirmation()} />);
    expect(screen.queryByRole('button', { name: /email/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /download voucher/i }));
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('links to the itinerary and a new booking', () => {
    const onViewItinerary = vi.fn();
    const onNewBooking = vi.fn();
    render(<HotelBookingConfirmation confirmation={confirmation()} onViewItinerary={onViewItinerary} onNewBooking={onNewBooking} />);
    fireEvent.click(screen.getByRole('button', { name: /view itinerary/i }));
    fireEvent.click(screen.getByRole('button', { name: /book another hotel/i }));
    expect(onViewItinerary).toHaveBeenCalled();
    expect(onNewBooking).toHaveBeenCalled();
  });
});
