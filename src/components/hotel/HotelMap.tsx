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
const MAX_ZOOM = 18;
// Price pins are wide and short, so pins overlap within a wide, short box
const OVERLAP_X = 64, OVERLAP_Y = 30;

/**
 * Group items whose pins would overlap on screen (x/y are pixel positions at the current zoom).
 * Greedy first pass: the first item in `order` (e.g. the cheapest) anchors its group, so each group starts with it.
 * Labels differ in width ("€95" vs "11 hotels · from €169"), so groups whose labels would still collide are then
 * merged until none do; `labelWidth` estimates a group's label width in pixels.
 */
export function clusterByPixels<T>(points: { item: T; x: number; y: number }[], order: (a: T, b: T) => number,
  labelWidth: (group: T[]) => number = () => OVERLAP_X, dx = OVERLAP_X, dy = OVERLAP_Y): T[][] {
  const sorted = [...points].sort((a, b) => order(a.item, b.item));
  const used = new Set<number>();
  let groups: { pts: typeof sorted }[] = [];
  sorted.forEach((a, i) => {
    if (used.has(i)) return;
    used.add(i);
    const pts = [a];
    sorted.forEach((b, j) => {
      if (!used.has(j) && Math.abs(a.x - b.x) < dx && Math.abs(a.y - b.y) < dy) { used.add(j); pts.push(b); }
    });
    groups.push({ pts });
  });

  // A group's pin sits at the centre of its points (as the marker does)
  const box = (g: { pts: typeof sorted }) => {
    const xs = g.pts.map(p => p.x), ys = g.pts.map(p => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2,
      w: labelWidth(g.pts.map(p => p.item)) };
  };
  for (let merged = true; merged && groups.length > 1;) {
    merged = false;
    const boxes = groups.map(box);
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (Math.abs(boxes[i].x - boxes[j].x) < (boxes[i].w + boxes[j].w) / 2 && Math.abs(boxes[i].y - boxes[j].y) < dy) {
          const pts = [...groups[i].pts, ...groups[j].pts].sort((a, b) => order(a.item, b.item));
          groups = [...groups.filter((_, k) => k !== i && k !== j), { pts }];
          merged = true;
          break outer;
        }
      }
    }
  }
  return groups
    .map(g => g.pts.map(p => p.item))
    .sort((a, b) => order(a[0], b[0]));
}

const pinLabel = (hotels: HotelResult[]) => {
  const from = formatPinPrice(hotels[0].price.offeredPrice, hotels[0].price.currency);
  return hotels.length === 1 ? from : `${hotels.length} hotels · from ${from}`;
};
// 13px label ≈ 7.2px per character, plus 20px padding, border and a small gap between pins
const estimateLabelWidth = (hotels: HotelResult[]) => pinLabel(hotels).length * 7.2 + 28;

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

// Hotels sharing one spot: a list to pick from
function listPopup(hotels: HotelResult[], onSelect: (h: HotelResult) => void) {
  const box = el('div', 'hotel-map-popup');
  box.append(el('strong', 'hotel-map-popup-name', `${hotels.length} hotels here`));
  const list = el('ul', 'hotel-map-popup-list');
  for (const hotel of hotels) {
    const button = el('button', 'hotel-map-popup-row');
    button.type = 'button';
    button.append(el('span', 'hotel-map-popup-row-name', hotel.hotelName),
      el('span', 'hotel-map-popup-row-price', formatPinPrice(hotel.price.offeredPrice, hotel.price.currency)));
    button.addEventListener('click', () => onSelect(hotel));
    const li = el('li', '');
    li.append(button);
    list.append(li);
  }
  box.append(list);
  return box;
}

const HotelMap: React.FC<HotelMapProps> = ({ hotels, activeCode, onActiveChange, onSelect }) => {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  // hotelCode → the marker showing it (a cluster marker is shared by all its hotels)
  const markers = useRef(new Map<string, L.Marker>());
  const shown = useRef<HotelResult[]>([]);
  // Latest props for Leaflet callbacks without rebuilding the markers on every render
  const latest = useRef({ onActiveChange, onSelect, activeCode });
  latest.current = { onActiveChange, onSelect, activeCode };

  const highlight = () => {
    const activeMarker = latest.current.activeCode ? markers.current.get(latest.current.activeCode) : undefined;
    new Set(markers.current.values()).forEach(marker => {
      const on = marker === activeMarker;
      marker.getElement()?.querySelector('.hotel-pin')?.classList.toggle('is-active', on);
      marker.setZIndexOffset(on ? 1000 : 0);
    });
  };

  // Draw the pins for the current zoom: hotels whose pins would overlap share one cluster pin
  const draw = () => {
    const m = map.current, group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    markers.current.clear();
    const list = shown.current.filter(located);
    const groups = clusterByPixels(
      list.map(h => ({ item: h, ...m.latLngToLayerPoint([h.latitude!, h.longitude!]) })),
      (a, b) => a.price.offeredPrice - b.price.offeredPrice,
      estimateLabelWidth,
    );
    for (const hotels of groups) {
      const marker = hotels.length === 1 ? hotelMarker(hotels[0]) : clusterMarker(m, hotels);
      marker.addTo(group);
      hotels.forEach(h => markers.current.set(h.hotelCode, marker));
    }
    highlight();
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const hotelMarker = (hotel: HotelResult) => {
    const marker = L.marker([hotel.latitude!, hotel.longitude!], {
      title: hotel.hotelName,
      alt: `${hotel.hotelName}, ${hotel.price.currency} ${hotel.price.offeredPrice.toFixed(2)}`,
      riseOnHover: true,
      icon: L.divIcon({
        className: 'hotel-pin-anchor', iconSize: [0, 0],
        html: `<span class="hotel-pin">${formatPinPrice(hotel.price.offeredPrice, hotel.price.currency)}</span>`,
      }),
    });
    marker.bindPopup(() => popupFor(hotel, h => latest.current.onSelect(h)), { closeButton: true, minWidth: 200, offset: [0, -30] });
    marker.on('mouseover', () => latest.current.onActiveChange(hotel.hotelCode));
    marker.on('mouseout', () => latest.current.onActiveChange(null));
    return marker;
  };

  const clusterMarker = (m: L.Map, hotels: HotelResult[]) => {
    const bounds = L.latLngBounds(hotels.map(h => [h.latitude!, h.longitude!] as L.LatLngTuple));
    const from = formatPinPrice(hotels[0].price.offeredPrice, hotels[0].price.currency);
    const marker = L.marker(bounds.getCenter(), {
      title: `${hotels.length} hotels from ${from}: ${hotels.map(h => h.hotelName).join(', ')}`,
      alt: `${hotels.length} hotels from ${from}`,
      riseOnHover: true,
      icon: L.divIcon({
        className: 'hotel-pin-anchor', iconSize: [0, 0],
        html: `<span class="hotel-pin hotel-pin-cluster"><b>${hotels.length}</b> hotels · from ${from}</span>`,
      }),
    });
    const samePlace = bounds.getNorthEast().equals(bounds.getSouthWest());
    marker.on('click', () => {
      // Zoom in until the pins separate; hotels at the same spot (or at full zoom) get a list instead
      const target = Math.min(Math.max(m.getBoundsZoom(bounds.pad(0.5)), m.getZoom() + 1), MAX_ZOOM);
      if (samePlace || m.getZoom() >= MAX_ZOOM) {
        L.popup({ minWidth: 220, offset: [0, -30] }).setLatLng(bounds.getCenter())
          .setContent(listPopup(hotels, h => latest.current.onSelect(h))).openOn(m);
      } else {
        m.setView(bounds.getCenter(), target);
      }
    });
    return marker;
  };

  useEffect(() => {
    const m = L.map(container.current!, { scrollWheelZoom: false, zoomControl: true, maxZoom: MAX_ZOOM });
    // Standard OpenStreetMap tiles: free, keyless, attribution required (fine for demo traffic; heavy use needs a tile provider)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: MAX_ZOOM,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.setView([20, 0], 2);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    // Clusters depend on the zoom: regroup after every zoom change
    m.on('zoomend', () => drawRef.current());
    // The map can mount before its box has its final size (lazy load, toggling it on)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null;
    ro?.observe(container.current!);
    return () => { ro?.disconnect(); m.remove(); map.current = null; layer.current = null; markers.current.clear(); };
  }, []);

  // New hotel list (search, filters): frame it, then draw
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    shown.current = hotels;
    const points = hotels.filter(located).map(h => [h.latitude!, h.longitude!] as L.LatLngTuple);
    if (points.length === 1) m.setView(points[0], 15, { animate: false });
    else if (points.length > 1) m.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15, animate: false });
    drawRef.current();
  }, [hotels]);

  // Highlight the hovered hotel's pin (or the cluster it is in)
  useEffect(highlight, [activeCode]);

  return <div ref={container} className="hotel-map" role="region" aria-label="Map of hotels" />;
};

export default HotelMap;
