// HotelMap with real Leaflet in jsdom: pins, popups, hover highlighting and safe handling of provider text.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import HotelMap, { clusterByPixels, formatPinPrice } from './HotelMap';
import { hotelResult, sizeHotelMaps } from '../../tests/hotelFixtures';

sizeHotelMaps();

const hotels = () => [
  hotelResult(),
  hotelResult({ hotelCode: 'b', bookingCode: 'b', hotelName: 'Breakfast Inn', latitude: 48.89, longitude: 2.30,
    price: { currency: 'EUR', offeredPrice: 120, publishedPrice: 120, discount: 0 } }),
  hotelResult({ hotelCode: 'c', bookingCode: 'c', hotelName: 'Nowhere Lodge', latitude: null, longitude: null }),
];
const pins = (c: HTMLElement) => [...c.querySelectorAll('.hotel-pin')].map(p => p.textContent);

describe('HotelMap', () => {
  it('shows a price pin for every hotel that has a location', () => {
    const { container } = render(<HotelMap hotels={hotels()} activeCode={null} onActiveChange={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Map of hotels' })).toBeInTheDocument();
    expect(pins(container)).toEqual(['€120', '€181']);              // drawn cheapest first
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

  it('groups pins that would overlap on screen, anchored on the cheapest', () => {
    const p = (item: { id: string; price: number }, x: number, y: number) => ({ item, x, y });
    const a = { id: 'a', price: 300 }, b = { id: 'b', price: 100 }, c = { id: 'c', price: 200 }, d = { id: 'd', price: 50 };
    const groups = clusterByPixels([p(a, 0, 0), p(b, 40, 10), p(c, 500, 0), p(d, 0, 200)], (x, y) => x.price - y.price);
    expect(groups.map(g => g.map(h => h.id))).toEqual([['d'], ['b', 'a'], ['c']]);
    // Pins are wide: 60 px apart sideways overlaps, 40 px apart vertically does not
    expect(clusterByPixels([p(a, 0, 0), p(b, 60, 0)], () => 0)).toHaveLength(1);
    expect(clusterByPixels([p(a, 0, 0), p(b, 0, 40)], () => 0)).toHaveLength(2);
  });

  it('merges groups whose wider labels would still collide', () => {
    const p = (id: string, x: number) => ({ item: { id }, x, y: 0 });
    // a+b are close and form a cluster; its wide label (160 px) reaches c 100 px away, so c joins it
    const wide = (g: { id: string }[]) => (g.length > 1 ? 160 : 50);
    const groups = clusterByPixels([p('a', 0), p('b', 20), p('c', 110), p('d', 400)], (x, y) => x.id.localeCompare(y.id), wide);
    expect(groups.map(g => g.map(h => h.id))).toEqual([['a', 'b', 'c'], ['d']]);
    // With narrow labels c stays on its own
    const narrow = clusterByPixels([p('a', 0), p('b', 20), p('c', 110)], (x, y) => x.id.localeCompare(y.id), () => 50);
    expect(narrow.map(g => g.map(h => h.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('merges nearby hotels into a cluster pin that zooms in to split them', async () => {
    // Two hotels 30 m apart in Paris and one in Lyon: framed together, the Paris pair would overlap
    const list = [
      hotelResult({ hotelCode: 'p1', bookingCode: 'p1', hotelName: 'Rive Gauche', latitude: 48.8600, longitude: 2.3400,
        price: { currency: 'EUR', offeredPrice: 210, publishedPrice: 210, discount: 0 } }),
      hotelResult({ hotelCode: 'p2', bookingCode: 'p2', hotelName: 'Rive Droite', latitude: 48.8602, longitude: 2.3402,
        price: { currency: 'EUR', offeredPrice: 150, publishedPrice: 150, discount: 0 } }),
      hotelResult({ hotelCode: 'l1', bookingCode: 'l1', hotelName: 'Lyon Centre', latitude: 45.7640, longitude: 4.8357 }),
    ];
    const onActiveChange = vi.fn();
    const { container, rerender } = render(<HotelMap hotels={list} activeCode={null} onActiveChange={onActiveChange} onSelect={vi.fn()} />);
    expect(pins(container)).toEqual(['2 hotels · from €150', '€181']);

    // Hovering a hotel in the cluster highlights the cluster
    rerender(<HotelMap hotels={list} activeCode="p1" onActiveChange={onActiveChange} onSelect={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.hotel-pin.is-active')).toHaveTextContent('2 hotels'));

    fireEvent.click(container.querySelector('.hotel-pin-cluster')!);
    await waitFor(() => expect(pins(container)).toHaveLength(3));
    expect(pins(container)).toEqual(expect.arrayContaining(['€150', '€210']));
  });

  it('lists hotels that share one spot, since zooming cannot separate them', async () => {
    const onSelect = vi.fn();
    const list = [
      hotelResult({ hotelCode: 's1', bookingCode: 's1', hotelName: 'Tower A' }),
      hotelResult({ hotelCode: 's2', bookingCode: 's2', hotelName: 'Tower B',
        price: { currency: 'EUR', offeredPrice: 99, publishedPrice: 99, discount: 0 } }),
    ];
    const { container } = render(<HotelMap hotels={list} activeCode={null} onActiveChange={vi.fn()} onSelect={onSelect} />);
    expect(pins(container)).toEqual(['2 hotels · from €99']);
    fireEvent.click(container.querySelector('.hotel-pin-cluster')!);
    expect(await screen.findByText('2 hotels here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tower A/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ hotelCode: 's1' }));
  });

  it('formats pin prices compactly and survives unknown currencies', () => {
    expect(formatPinPrice(1234.56, 'USD')).toBe('$1,235');
    expect(formatPinPrice(99, 'ZZZZ')).toBe('ZZZZ 99');
  });
});
