// Shared test data for the hotel flow (shapes returned by /api/v1/hotels).
import type { HotelSearchHit } from '../services/hotelApi';
import type { HotelResult, HotelSearchCriteria } from '../services/hotelSearchService';
import type { HotelBookingSession } from '../services/hotelBookingService';
import type { PreBookResult } from '../services/preBookService';

const inDays = (n: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
};

export const searchHit = (over: Partial<HotelSearchHit> = {}): HotelSearchHit => ({
  hotelId: 'lp1897',
  name: 'Hotel Lumière',
  address: '12 Rue de Rivoli',
  city: 'Paris',
  countryCode: 'FR',
  starRating: 4,
  guestRating: 8.7,
  photo: 'https://img.example/lp1897.jpg',
  latitude: 48.86,
  longitude: 2.34,
  offers: [
    { offerId: 'offer-cheap', roomName: 'Standard King Room', boardName: 'Room Only', refundable: false,
      cancellation: 'Non-refundable', price: 180.5, currency: 'EUR' },
    { offerId: 'offer-flex', roomName: 'Deluxe Room', boardName: 'Breakfast Included', refundable: true,
      cancellation: 'Free cancellation until 2027-03-08 12:00', price: 240, currency: 'EUR' },
  ],
  ...over,
});

export const hotelResult = (over: Partial<HotelResult> = {}): HotelResult => {
  const hit = searchHit();
  return {
    bookingCode: 'offer-cheap',
    hotelCode: hit.hotelId,
    hotelName: hit.name,
    starRating: 4,
    guestRating: 8.7,
    address: hit.address,
    cityName: 'Paris',
    countryName: 'FR',
    latitude: 48.86,
    longitude: 2.34,
    price: { currency: 'EUR', offeredPrice: 180.5, publishedPrice: 180.5, discount: 0 },
    nights: 2,
    refundable: false,
    cancellationPolicy: 'Non-refundable',
    mealType: 'Room Only',
    roomType: 'Standard King Room',
    amenities: [],
    hotelPicture: hit.photo!,
    hotelImages: [hit.photo!],
    offers: hit.offers,
    ...over,
  };
};

export const criteria = (over: Partial<HotelSearchCriteria> = {}): HotelSearchCriteria => ({
  checkIn: inDays(30),
  checkOut: inDays(32),
  city: 'Paris',
  countryCode: 'FR',
  guestNationality: 'IN',
  paxRooms: [{ adults: 2, children: 0, childrenAges: [] }],
  ...over,
});

export const preBookResult = (over: Partial<PreBookResult> = {}): PreBookResult => ({
  bookingCode: 'offer-cheap',
  prebookId: 'pb-1',
  originalPrice: 180.5,
  currentPrice: 180.5,
  priceChanged: false,
  priceIncrease: 0,
  available: true,
  currency: 'EUR',
  cancellationPolicyChanged: false,
  boardChanged: false,
  refundable: false,
  cancellationPolicy: 'Non-refundable',
  ...over,
});

export const session = (over: Partial<HotelBookingSession> = {}): HotelBookingSession => ({
  sessionId: 'hotel_session_test',
  hotel: hotelResult(),
  searchCriteria: criteria(),
  bookingCode: 'offer-cheap',
  status: 'details',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 30 * 60_000),
  ...over,
});

/**
 * jsdom has no layout, so a Leaflet map is 0×0 and every pin lands on the same pixel (and clusters).
 * Give `.hotel-map` elements a real size so zoom and clustering behave as in a browser.
 */
export const sizeHotelMaps = (width = 800, height = 400) => {
  const size = (dim: number) => ({ configurable: true, get(this: HTMLElement) { return this.classList?.contains('hotel-map') ? dim : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', size(width));
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', size(height));
};
