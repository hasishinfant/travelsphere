import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import HotelSearchResults from './HotelSearchResults';
import type { HotelSearchResult } from '../../services/hotelSearchService';
import { criteria, hotelResult, sizeHotelMaps } from '../../tests/hotelFixtures';

sizeHotelMaps();

const results = (over: Partial<HotelSearchResult> = {}): HotelSearchResult => {
  const hotels = [
    hotelResult(),
    hotelResult({ bookingCode: 'b', hotelCode: 'b', hotelName: 'Breakfast Inn', starRating: 3, refundable: true,
      latitude: 48.89, longitude: 2.30,
      mealType: 'Breakfast Included', price: { currency: 'EUR', offeredPrice: 120, publishedPrice: 120, discount: 0 } }),
    hotelResult({ bookingCode: 'c', hotelCode: 'c', hotelName: 'Aurora Palace', starRating: 5, mealType: 'Half Board',
      latitude: 48.83, longitude: 2.39,
      price: { currency: 'EUR', offeredPrice: 410, publishedPrice: 410, discount: 0 }, hotelPicture: '' }),
  ];
  return { hotels, searchCriteria: criteria(), totalResults: hotels.length, sandbox: false, ...over };
};
const names = () => screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);

describe('HotelSearchResults', () => {
  it('lists hotels cheapest first with the total for the stay', () => {
    render(<HotelSearchResults searchResult={results()} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('3 Hotels Found');
    expect(screen.getByText('in Paris, FR')).toBeInTheDocument();
    expect(names()).toEqual(['Breakfast Inn', 'Hotel Lumière', 'Aurora Palace']);
    expect(screen.getAllByText('total, 2 nights')).toHaveLength(3);
    expect(screen.getAllByText('2 room options')).toHaveLength(3);
  });

  it('labels sandbox results as test mode', () => {
    const { rerender } = render(<HotelSearchResults searchResult={results()} />);
    expect(screen.queryByText(/Test mode:/)).not.toBeInTheDocument();
    rerender(<HotelSearchResults searchResult={results({ sandbox: true })} />);
    expect(screen.getByText(/Test mode:/)).toBeInTheDocument();
  });

  it('filters by stars, cancellation and meal plan, and clears filters', () => {
    render(<HotelSearchResults searchResult={results()} />);
    fireEvent.change(screen.getByLabelText('Star Rating'), { target: { value: '5' } });
    expect(names()).toEqual(['Aurora Palace']);
    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    fireEvent.change(screen.getByLabelText('Cancellation'), { target: { value: 'true' } });
    expect(names()).toEqual(['Breakfast Inn']);
    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    fireEvent.change(screen.getByLabelText('Meal Plan'), { target: { value: 'half_board' } });
    expect(names()).toEqual(['Aurora Palace']);
  });

  it('sorts by stars and by name', () => {
    render(<HotelSearchResults searchResult={results()} />);
    fireEvent.change(screen.getByLabelText('Sort By'), { target: { value: 'rating' } });
    expect(names()[0]).toBe('Aurora Palace');
    fireEvent.change(screen.getByLabelText('Sort By'), { target: { value: 'name' } });
    expect(names()).toEqual(['Aurora Palace', 'Breakfast Inn', 'Hotel Lumière']);
  });

  it('opens a hotel and shows a placeholder when there is no photo', () => {
    const onHotelSelect = vi.fn();
    const { container } = render(<HotelSearchResults searchResult={results()} onHotelSelect={onHotelSelect} />);
    expect(container.querySelectorAll('.hotel-image-empty')).toHaveLength(1);
    const card = screen.getByText('Breakfast Inn').closest('.hotel-card') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'View Details' }));
    expect(onHotelSelect).toHaveBeenCalledWith(expect.objectContaining({ hotelCode: 'b' }));
  });

  it('shows the hotels on a map that can be hidden, and remembers the choice', async () => {
    localStorage.clear();
    const { container, unmount } = render(<HotelSearchResults searchResult={results()} />);
    expect(await screen.findByRole('region', { name: 'Map of hotels' })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('.hotel-pin')).toHaveLength(3));

    fireEvent.change(screen.getByLabelText('Star Rating'), { target: { value: '5' } });   // map follows the filters
    await waitFor(() => expect(container.querySelectorAll('.hotel-pin')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /hide map/i }));
    expect(screen.queryByRole('region', { name: 'Map of hotels' })).not.toBeInTheDocument();
    unmount();
    render(<HotelSearchResults searchResult={results()} />);
    expect(screen.getByRole('button', { name: /show map/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: 'Map of hotels' })).not.toBeInTheDocument();
    localStorage.clear();
  });

  it('links a hovered card to its pin and says when hotels have no location', async () => {
    localStorage.clear();
    const r = results();
    r.hotels[2] = { ...r.hotels[2], latitude: null, longitude: null };
    const { container } = render(<HotelSearchResults searchResult={r} />);
    await waitFor(() => expect(container.querySelectorAll('.hotel-pin')).toHaveLength(2));
    expect(screen.getByText(/2 of 3 hotels shown on the map/)).toBeInTheDocument();
    const card = screen.getByText('Breakfast Inn').closest('.hotel-card') as HTMLElement;
    fireEvent.mouseEnter(card);
    expect(card).toHaveClass('is-active');
    await waitFor(() => expect(container.querySelector('.hotel-pin.is-active')).toHaveTextContent('€120'));
    fireEvent.mouseLeave(card);
    expect(card).not.toHaveClass('is-active');
  });

  it('explains when nothing matches', () => {
    render(<HotelSearchResults searchResult={results({ hotels: [], totalResults: 0 })} />);
    expect(screen.getByText('No Hotels Found')).toBeInTheDocument();
  });
});
