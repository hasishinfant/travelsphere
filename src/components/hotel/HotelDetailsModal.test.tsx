import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import HotelDetailsModal from './HotelDetailsModal';
import { hotelResult } from '../../tests/hotelFixtures';
import type { HotelDetailsResult } from '../../services/hotelDetailsService';

const getHotelDetails = vi.fn();
vi.mock('../../services/hotelDetailsService', () => ({ getHotelDetailsService: () => ({ getHotelDetails }) }));

const details: HotelDetailsResult = {
  hotelCode: 'lp1897', hotelName: 'Hotel Lumière', starRating: 4, description: 'Steps from the Louvre.',
  facilities: ['Free Wi-Fi', 'Lift'], policy: { checkInTime: '15:00', checkOutTime: '11:00' },
  importantInformation: 'City tax payable at the hotel.', images: ['a.jpg', 'b.jpg'], address: '12 Rue de Rivoli',
  cityName: 'Paris', countryName: 'FR', location: { latitude: 48.8606, longitude: 2.3376 },
};

beforeEach(() => { getHotelDetails.mockReset(); });

describe('HotelDetailsModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<HotelDetailsModal hotel={hotelResult()} isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the provider details, policies and location', async () => {
    getHotelDetails.mockResolvedValue(details);
    render(<HotelDetailsModal hotel={hotelResult()} isOpen onClose={vi.fn()} />);
    expect(await screen.findByText('Steps from the Louvre.')).toBeInTheDocument();
    expect(getHotelDetails).toHaveBeenCalledWith('lp1897');
    expect(screen.getByText('Free Wi-Fi')).toBeInTheDocument();
    expect(screen.getByText('15:00')).toBeInTheDocument();
    expect(screen.getByText('City tax payable at the hotel.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view on map/i })).toHaveAttribute('href', expect.stringContaining('mlat=48.8606'));
    expect(screen.getByText('total for 2 nights')).toBeInTheDocument();
  });

  it('books the room the traveller chose', async () => {
    getHotelDetails.mockResolvedValue(details);
    const onBookNow = vi.fn();
    render(<HotelDetailsModal hotel={hotelResult()} isOpen onClose={vi.fn()} onBookNow={onBookNow} />);
    await screen.findByText('Steps from the Louvre.');
    fireEvent.click(screen.getByRole('radio', { name: /deluxe room/i }));
    expect(screen.getByText('240.00', { selector: '.current-price .amount' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Book Now' }));
    expect(onBookNow).toHaveBeenCalledWith(expect.objectContaining({
      bookingCode: 'offer-flex', roomType: 'Deluxe Room', mealType: 'Breakfast Included', refundable: true,
      price: expect.objectContaining({ offeredPrice: 240 }),
    }));
  });

  it('shows an error when details cannot be loaded, and still offers the rooms', async () => {
    getHotelDetails.mockRejectedValue(new Error('down'));
    render(<HotelDetailsModal hotel={hotelResult()} isOpen onClose={vi.fn()} />);
    expect(await screen.findByText('Unable to load hotel details. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Book Now' })).toBeEnabled();
  });

  it('closes from the close button and the backdrop', async () => {
    getHotelDetails.mockResolvedValue(details);
    const onClose = vi.fn();
    const { container } = render(<HotelDetailsModal hotel={hotelResult()} isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(container.querySelector('.hotel-details-modal-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
