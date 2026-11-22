import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import HotelSearchForm from './HotelSearchForm';

const search = vi.fn();
vi.mock('../../services/hotelSearchService', () => ({ getHotelSearchService: () => ({ search }) }));

const ymd = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fill = (city = 'Lisbon', country = 'pt') => {
  fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: city } });
  fireEvent.change(screen.getByLabelText(/country code/i), { target: { value: country } });
  fireEvent.change(screen.getByLabelText(/check-in date/i), { target: { value: ymd(10) } });
  fireEvent.change(screen.getByLabelText(/check-out date/i), { target: { value: ymd(13) } });
};

beforeEach(() => {
  search.mockReset();
  window.history.replaceState(null, '', '/');
});

describe('HotelSearchForm', () => {
  it('searches any city by name and 2-letter country code', async () => {
    const result = { hotels: [], totalResults: 0, sandbox: true, searchCriteria: {} };
    search.mockResolvedValue(result);
    const onSearchComplete = vi.fn();
    render(<HotelSearchForm onSearchComplete={onSearchComplete} />);
    fill();
    expect(screen.getByLabelText(/country code/i)).toHaveValue('PT');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => expect(onSearchComplete).toHaveBeenCalledWith(result));
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      city: 'Lisbon', countryCode: 'PT', guestNationality: 'US',
      paxRooms: [{ adults: 2, children: 0, childrenAges: [] }],
    }));
  });

  it('requires a city and a valid country code', async () => {
    render(<HotelSearchForm />);
    fill('', '');
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(await screen.findByText('Please enter a city')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^city/i), { target: { value: 'Lisbon' } });
    fireEvent.change(screen.getByLabelText(/country code/i), { target: { value: 'P' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(await screen.findByText(/2-letter country code/)).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  it('shows the server message when hotel booking is not configured', async () => {
    search.mockRejectedValue(new Error('Hotel booking is not configured. Add LITEAPI_API_KEY to server/.env'));
    const onSearchError = vi.fn();
    render(<HotelSearchForm onSearchError={onSearchError} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /search/i }));
    expect(await screen.findByText(/Hotel booking is not configured/)).toBeInTheDocument();
    expect(onSearchError).toHaveBeenCalled();
  });

  it('prefills city and country from the destination in the URL', () => {
    window.history.replaceState(null, '', '/book-hotels?location=kyoto');
    render(<HotelSearchForm />);
    expect(screen.getByLabelText(/^city/i)).toHaveValue('Kyoto');
    expect(screen.getByLabelText(/country code/i)).toHaveValue('JP');
  });

  it('limits a search to five rooms', () => {
    render(<HotelSearchForm />);
    for (let i = 0; i < 6; i++) {
      const add = screen.queryByRole('button', { name: /add room/i });
      if (add) fireEvent.click(add);
    }
    expect(screen.queryByRole('button', { name: /add room/i })).not.toBeInTheDocument();
  });
});
