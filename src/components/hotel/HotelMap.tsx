/**
 * Map of hotel search results (Leaflet + OpenStreetMap tiles; no API key).
 * Each hotel is a price pin; hovering a pin or its card highlights both, and a pin's popup opens the hotel.
 * Loaded lazily so Leaflet only downloads when results are shown.
 */
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { HotelResult } from '../../services/hotelSearchService';
import './HotelMap.css';

export interface HotelMapProps {
  hotels: HotelResult[];
  activeCode: string | null;
  onActiveChange: (hotelCode: string | null) => void;
  onSelect: (hotel: HotelResult) => void;
}

const located = (h: HotelResult) => h.latitude != null && h.longitude != null;

export const formatPinPrice = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
};

// Provider text goes in via textContent only, never as HTML
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function popupFor(hotel: HotelResult, onSelect: (h: HotelResult) => void) {
  const box = el('div', 'hotel-map-popup');
  if (hotel.hotelPicture) {
    const img = el('img', 'hotel-map-popup-img');
    img.src = hotel.hotelPicture;
    img.alt = '';
    img.loading = 'lazy';
    box.append(img);
  }
  box.append(el('strong', 'hotel-map-popup-name', hotel.hotelName));
  const meta = [hotel.starRating ? '★'.repeat(hotel.starRating) : '', hotel.guestRating ? `${hotel.guestRating}/10` : '']
    .filter(Boolean).join(' · ');
  if (meta) box.append(el('span', 'hotel-map-popup-meta', meta));
  box.append(el('span', 'hotel-map-popup-price',
    `${hotel.price.currency} ${hotel.price.offeredPrice.toFixed(2)} total, ${hotel.nights} night${hotel.nights === 1 ? '' : 's'}`));
  const button = el('button', 'hotel-map-popup-btn', 'View Details');
  button.type = 'button';
  button.addEventListener('click', () => onSelect(hotel));
  box.append(button);
  return box;
}

const HotelMap: React.FC<HotelMapProps> = ({ hotels, activeCode, onActiveChange, onSelect }) => {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  // Latest callbacks without rebuilding the markers on every render
  const handlers = useRef({ onActiveChange, onSelect });
  handlers.current = { onActiveChange, onSelect };

  useEffect(() => {
    const m = L.map(container.current!, { scrollWheelZoom: false, zoomControl: true });
    // Standard OpenStreetMap tiles: free, keyless, attribution required (fine for demo traffic; heavy use needs a tile provider)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.setView([20, 0], 2);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    // The map can mount before its box has its final size (lazy load, toggling it on)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null;
    ro?.observe(container.current!);
    return () => { ro?.disconnect(); m.remove(); map.current = null; layer.current = null; markers.current.clear(); };
  }, []);

  // Rebuild pins when the visible hotels change (search, filters) and frame them
  useEffect(() => {
    const m = map.current, group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    markers.current.clear();
    const points: L.LatLngExpression[] = [];
    for (const hotel of hotels.filter(located)) {
      const pos: L.LatLngExpression = [hotel.latitude!, hotel.longitude!];
      const marker = L.marker(pos, {
        title: hotel.hotelName,
        alt: `${hotel.hotelName}, ${hotel.price.currency} ${hotel.price.offeredPrice.toFixed(2)}`,
        riseOnHover: true,
        icon: L.divIcon({
          className: 'hotel-pin-anchor', iconSize: [0, 0],
          html: `<span class="hotel-pin">${formatPinPrice(hotel.price.offeredPrice, hotel.price.currency)}</span>`,
        }),
      });
      marker.bindPopup(() => popupFor(hotel, h => handlers.current.onSelect(h)), { closeButton: true, minWidth: 200, offset: [0, -30] });
      marker.on('mouseover', () => handlers.current.onActiveChange(hotel.hotelCode));
      marker.on('mouseout', () => handlers.current.onActiveChange(null));
      marker.addTo(group);
      markers.current.set(hotel.hotelCode, marker);
      points.push(pos);
    }
    if (points.length === 1) m.setView(points[0], 15);
    else if (points.length > 1) m.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
  }, [hotels]);

  // Highlight the hovered hotel's pin
  useEffect(() => {
    markers.current.forEach((marker, code) => {
      const on = code === activeCode;
      marker.getElement()?.querySelector('.hotel-pin')?.classList.toggle('is-active', on);
      marker.setZIndexOffset(on ? 1000 : 0);
    });
  }, [activeCode, hotels]);

  return <div ref={container} className="hotel-map" role="region" aria-label="Map of hotels" />;
};

export default HotelMap;
