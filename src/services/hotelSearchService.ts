/**
 * Hotel search: live availability and prices from the hotel provider via the TravelSphere API,
 * mapped to the model the hotel screens use. Filtering is done client-side on the returned results.
 */

import { hotelApi, ymd, type HotelOffer, type HotelSearchHit } from './hotelApi';

// ============================================================================
// Types
// ============================================================================

export interface PaxRoomInput {
  adults: number;
  children: number;
  childrenAges: number[];
}

export interface HotelSearchCriteria {
  checkIn: Date;
  checkOut: Date;
  city: string;
  countryCode: string;        // ISO 3166-1 alpha-2
  guestNationality: string;   // ISO 3166-1 alpha-2
  paxRooms: PaxRoomInput[];
  currency?: string;
}

export interface HotelSearchFilters {
  refundable?: boolean;
  starRating?: number;
  mealPlan?: MealPlan;
  hotelName?: string;
}

export type MealPlan = 'room_only' | 'breakfast' | 'half_board' | 'full_board' | 'all_inclusive';

export interface HotelResult {
  /** Offer id of the cheapest room — used to verify price and book. */
  bookingCode: string;
  hotelCode: string;
  hotelName: string;
  starRating: number;
  guestRating: number | null;
  address: string;
  cityName: string;
  countryName: string;
  latitude: number | null;
  longitude: number | null;
  /** Total for the whole stay and all rooms. */
  price: {
    currency: string;
    offeredPrice: number;
    publishedPrice: number;
    discount: number;
  };
  nights: number;
  refundable: boolean;
  cancellationPolicy: string;
  mealType: string;
  roomType: string;
  amenities: string[];
  hotelPicture: string;
  hotelImages: string[];
  /** Other bookable rooms for this hotel, cheapest first. */
  offers: HotelOffer[];
}

export interface HotelSearchResult {
  hotels: HotelResult[];
  searchCriteria: HotelSearchCriteria;
  totalResults: number;
  /** True when results come from the provider's sandbox (test bookings, nothing is charged). */
  sandbox: boolean;
}

export interface HotelSearchSession {
  sessionId: string;
  searchCriteria: HotelSearchCriteria;
  results: HotelSearchResult;
  createdAt: Date;
}

// ============================================================================
// Mapping
// ============================================================================

export function toHotelResult(hit: HotelSearchHit, nights: number): HotelResult {
  const best = hit.offers[0];
  return {
    bookingCode: best.offerId,
    hotelCode: hit.hotelId,
    hotelName: hit.name,
    starRating: Math.round(hit.starRating),
    guestRating: hit.guestRating,
    address: hit.address,
    cityName: hit.city,
    countryName: hit.countryCode,
    latitude: hit.latitude,
    longitude: hit.longitude,
    price: { currency: best.currency, offeredPrice: best.price, publishedPrice: best.price, discount: 0 },
    nights,
    refundable: best.refundable,
    cancellationPolicy: best.cancellation,
    mealType: best.boardName,
    roomType: best.roomName,
    amenities: [],
    hotelPicture: hit.photo ?? '',
    hotelImages: hit.photo ? [hit.photo] : [],
    offers: hit.offers,
  };
}

const MEAL_PATTERNS: Record<MealPlan, RegExp> = {
  room_only: /room only|room-only|no meals|without breakfast/i,
  breakfast: /breakfast|\bb&b\b|bed and breakfast/i,
  half_board: /half.?board/i,
  full_board: /full.?board/i,
  all_inclusive: /all.?inclusive/i,
};

export const matchesMealPlan = (boardName: string, plan: MealPlan) =>
  plan === 'breakfast'
    ? MEAL_PATTERNS.breakfast.test(boardName) && !/half|full|all.?inclusive/i.test(boardName)
    : MEAL_PATTERNS[plan].test(boardName);

// ============================================================================
// Service
// ============================================================================

export class HotelSearchService {
  private currentSession: HotelSearchSession | null = null;

  async search(criteria: HotelSearchCriteria): Promise<HotelSearchResult> {
    this.validateSearchCriteria(criteria);
    const response = await hotelApi.search({
      city: criteria.city.trim(),
      country_code: criteria.countryCode.trim().toUpperCase(),
      checkin: ymd(criteria.checkIn),
      checkout: ymd(criteria.checkOut),
      rooms: criteria.paxRooms.map(r => ({ adults: r.adults, children: r.childrenAges.slice(0, r.children) })),
      currency: criteria.currency,
      guest_nationality: criteria.guestNationality,
    });
    const hotels = response.hotels.filter(h => h.offers.length).map(h => toHotelResult(h, response.nights));
    const result: HotelSearchResult = { hotels, searchCriteria: criteria, totalResults: hotels.length, sandbox: response.sandbox };
    this.currentSession = {
      sessionId: `search_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      searchCriteria: criteria,
      results: result,
      createdAt: new Date(),
    };
    return result;
  }

  /** Client-side filtering of returned results (all filters must match). */
  filterResults(results: HotelResult[], filters: HotelSearchFilters): HotelResult[] {
    if (!filters) return results;
    const name = filters.hotelName?.trim().toLowerCase();
    return results.filter(h =>
      (filters.refundable === undefined || h.refundable === filters.refundable)
      && (filters.starRating === undefined || h.starRating === filters.starRating)
      && (filters.mealPlan === undefined || matchesMealPlan(h.mealType, filters.mealPlan))
      && (!name || h.hotelName.toLowerCase().includes(name)));
  }

  getCurrentSearchSession(): HotelSearchSession | null {
    return this.currentSession;
  }

  clearSession(): void {
    this.currentSession = null;
  }

  private validateSearchCriteria(criteria: HotelSearchCriteria): void {
    if (!criteria.checkIn || !criteria.checkOut) throw new Error('Check-in and check-out dates are required');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (criteria.checkIn < today) throw new Error('Check-in date cannot be in the past');
    if (criteria.checkOut <= criteria.checkIn) throw new Error('Check-out date must be after check-in date');
    if (!criteria.city?.trim()) throw new Error('City is required');
    if (!/^[A-Za-z]{2}$/.test(criteria.countryCode?.trim() ?? '')) throw new Error('Country must be a 2-letter code, e.g. FR');
    if (!criteria.paxRooms?.length) throw new Error('At least one room is required');
    if (criteria.paxRooms.length > 5) throw new Error('At most 5 rooms can be booked at once');
    criteria.paxRooms.forEach((room, i) => {
      if (room.adults < 1) throw new Error(`Room ${i + 1}: at least one adult is required`);
      if (room.children !== room.childrenAges.length) throw new Error(`Room ${i + 1}: provide an age for each child`);
    });
  }
}

let instance: HotelSearchService | null = null;

export function getHotelSearchService(): HotelSearchService {
  if (!instance) instance = new HotelSearchService();
  return instance;
}

export function resetHotelSearchService(): void {
  instance = null;
}

export default getHotelSearchService();
