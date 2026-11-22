// Client for the TravelSphere hotel API (/api/v1/hotels). The server talks to the hotel provider (LiteAPI);
// the provider key never reaches the browser.
import { api } from './apiClient';

export interface HotelOffer {
  offerId: string;
  roomName: string;
  boardName: string;
  refundable: boolean;
  cancellation: string;
  price: number;
  currency: string;
}

export interface HotelSearchHit {
  hotelId: string;
  name: string;
  address: string;
  city: string;
  countryCode: string;
  starRating: number;
  guestRating: number | null;
  photo: string | null;
  latitude: number | null;
  longitude: number | null;
  offers: HotelOffer[];
}

export interface HotelSearchResponse {
  hotels: HotelSearchHit[];
  sandbox: boolean;
  nights: number;
  rooms: number;
}

export interface HotelDetailsResponse {
  hotelId: string;
  name: string;
  description: string;
  address: string;
  city: string;
  countryCode: string;
  starRating: number;
  images: string[];
  facilities: string[];
  latitude: number | null;
  longitude: number | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  importantInformation: string | null;
}

export interface PrebookResponse {
  prebookId: string;
  offerId: string;
  hotelId: string;
  price: number;
  currency: string;
  priceDifferencePercent: number;
  cancellationChanged: boolean;
  boardChanged: boolean;
  refundable: boolean;
  cancellation: string;
}

export interface StoredBooking {
  booking_id: string;
  hotel_id: string;
  hotel_name: string;
  city: string | null;
  country_code: string | null;
  checkin: string;
  checkout: string;
  rooms: number;
  guests: number;
  room_name: string | null;
  board_name: string | null;
  price: string | number;
  currency: string;
  refundable: boolean | null;
  status: 'CONFIRMED' | 'CANCELLED' | 'CANCELLED_WITH_CHARGES';
  cancellation_fee: string | number | null;
  refund_amount: string | number | null;
  sandbox: boolean;
  holder_name: string;
  created_at: string;
}

export interface ProviderBooking {
  bookingId: string;
  status: string;
  price: number;
  currency: string;
  checkin: string;
  checkout: string;
  hotelName: string | null;
  hotelConfirmationCode: string | null;
  rooms: { roomName: string; boardName: string; adults: number; children: number; guestName: string }[];
  holder: { firstName: string; lastName: string; email: string } | null;
  cancellation: string;
}

export interface BookRequest {
  prebook_id: string;
  hotel: { id: string; name: string; city?: string; country_code?: string };
  checkin: string;
  checkout: string;
  room_name?: string;
  board_name?: string;
  refundable?: boolean;
  guests_count: number;
  holder: { first_name: string; last_name: string; email: string; phone: string };
  guests: { first_name: string; last_name: string }[];
}

export interface SearchRequest {
  city?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  checkin: string;
  checkout: string;
  rooms: { adults: number; children: number[] }[];
  currency?: string;
  guest_nationality?: string;
}

export const hotelApi = {
  status: () => api<{ configured: boolean; environment: 'sandbox' | 'production' | null; live_bookings_enabled: boolean }>(
    '/v1/hotels/status'),
  search: (body: SearchRequest) => api<HotelSearchResponse>('/v1/hotels/search', { method: 'POST', body }),
  details: (hotelId: string) =>
    api<{ hotel: HotelDetailsResponse }>(`/v1/hotels/${encodeURIComponent(hotelId)}`).then(r => r.hotel),
  prebook: (offerId: string) =>
    api<{ prebook: PrebookResponse }>('/v1/hotels/prebook', { method: 'POST', body: { offer_id: offerId } }).then(r => r.prebook),
  book: (body: BookRequest) =>
    api<{ booking: StoredBooking; recorded: boolean }>('/v1/hotels/book', { method: 'POST', body }),
  bookings: (from?: string, to?: string) => {
    const q = new URLSearchParams({ limit: '100', ...(from ? { from } : {}), ...(to ? { to } : {}) });
    return api<{ bookings: StoredBooking[] }>(`/v1/hotels/bookings?${q}`).then(r => r.bookings);
  },
  booking: (bookingId: string) =>
    api<{ booking: StoredBooking & { provider: ProviderBooking } }>(`/v1/hotels/bookings/${encodeURIComponent(bookingId)}`)
      .then(r => r.booking),
  cancel: (bookingId: string) =>
    api<{ cancellation: { bookingId: string; status: string; cancellationFee: number; refundAmount: number; currency: string } }>(
      `/v1/hotels/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'POST' }).then(r => r.cancellation),
};

/** Local calendar date (YYYY-MM-DD) — dates picked in the form are local, not UTC. */
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
