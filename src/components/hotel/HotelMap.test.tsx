// HotelMap with real Leaflet in jsdom: pins, popups, hover highlighting and safe handling of provider text.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import HotelMap, { formatPinPrice } from './HotelMap';
import { hotelResult } from '../../tests/hotelFixtures';

const hotels = () => [
  hotelResult(),
  hotelResult({ hotelCode: 'b', bookingCode: 'b', hotelName: 'Breakfast Inn', latitude: 48.87, longitude: 2.35,
    price: { currency: 'EUR', offeredPrice: 120, publishedPrice: 120, discount: 0 } }),
  hotelResult({ hotelCode: 'c', bookingCode: 'c', hotelName: 'Nowhere Lodge', latitude: null, longitude: null }),
];
const pins = (c: HTMLElement) => [...c.querySelectorAll('.hotel-pin')].map(p => p.textContent);

describe('HotelMap', () => {
  it('shows a price pin for every hotel that has a location', () => {
    const { container } = render(<HotelMap hotels={hotels()} activeCode={null} onActiveChange={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Map of hotels' })).toBeInTheDocument();
    expect(pins(container)).toEqual(['€181', '€120']);
    expect(container.querySelector('[title="Nowhere Lodge"]')).toBeNull();
  });

  it('updates the pins when the hotel list changes', () => {
    const props = { activeCode: null, onActiveChange: vi.fn(), onSelect: vi.fn() };
    const { container, rerender } = render(<HotelMap hotels={hotels()} {...props} />);
    rerender(<HotelMap hotels={hotels().slice(1, 2)} {...props} />);
    expect(pins(container)).toEqual(['€120']);
  });

  it('opens a popup that leads to the hotel', async () => {
    const onSelect = vi.fn();
    const { container } = render(<HotelMap hotels={hotels()} activeCode={null} onActiveChange={vi.fn()} onSelect={onSelect} />);
    fireEvent.click(container.querySelector('[title="Breakfast Inn"]')!);
    const view = await screen.findByRole('button', { name: 'View Details' });
    expect(screen.getByText('EUR 120.00 total, 2 nights')).toBeInTheDocument();
    fireEvent.click(view);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ hotelCode: 'b' }));
  });

  it('highlights the active hotel and reports hovers', async () => {
    const onActiveChange = vi.fn();
    const { container, rerender } = render(
      <HotelMap hotels={hotels()} activeCode={null} onActiveChange={onActiveChange} onSelect={vi.fn()} />);
    fireEvent.mouseOver(container.querySelector('[title="Breakfast Inn"]')!);
    expect(onActiveChange).toHaveBeenCalledWith('b');
    rerender(<HotelMap hotels={hotels()} activeCode="b" onActiveChange={onActiveChange} onSelect={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.hotel-pin.is-active')).toHaveTextContent('€120'));
  });

  it('renders hotel names from the provider as text, not HTML', async () => {
    const evil = hotelResult({ hotelName: '<img src=x onerror="window.__pwned=1">Hotel' });
    const { container } = render(<HotelMap hotels={[evil]} activeCode={null} onActiveChange={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.click(container.querySelector('.leaflet-marker-icon')!);
    expect(await screen.findByText('<img src=x onerror="window.__pwned=1">Hotel')).toBeInTheDocument();
    expect(container.querySelector('.hotel-map-popup img[src="x"]')).toBeNull();
  });

  it('formats pin prices compactly and survives unknown currencies', () => {
    expect(formatPinPrice(1234.56, 'USD')).toBe('$1,235');
    expect(formatPinPrice(99, 'ZZZZ')).toBe('ZZZZ 99');
  });
});
