/**
 * Hotel details (description, photos, facilities, check-in/out times) from the hotel provider via the
 * TravelSphere API. Results are cached for 30 minutes per hotel.
 */

import { hotelApi, type HotelDetailsResponse } from './hotelApi';

export interface HotelDetailsResult {
  hotelCode: string;
  hotelName: string;
  starRating: number;
  description: string;
  facilities: string[];
  policy: {
    checkInTime: string | null;
    checkOutTime: string | null;
  };
  importantInformation: string | null;
  images: string[];
  address: string;
  cityName: string;
  countryName: string;
  location: { latitude: number; longitude: number } | null;
}

const CACHE_MS = 30 * 60_000;

export function toDetailsResult(d: HotelDetailsResponse): HotelDetailsResult {
  return {
    hotelCode: d.hotelId,
    hotelName: d.name,
    starRating: Math.round(d.starRating),
    description: d.description,
    facilities: d.facilities,
    policy: { checkInTime: d.checkinTime, checkOutTime: d.checkoutTime },
    importantInformation: d.importantInformation,
    images: d.images,
    address: d.address,
    cityName: d.city,
    countryName: d.countryCode,
    location: d.latitude !== null && d.longitude !== null ? { latitude: d.latitude, longitude: d.longitude } : null,
  };
}

export class HotelDetailsService {
  private cache = new Map<string, { data: HotelDetailsResult; at: number }>();

  async getHotelDetails(hotelCode: string): Promise<HotelDetailsResult> {
    if (!hotelCode) throw new Error('A hotel id is required');
    const hit = this.cache.get(hotelCode);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    const data = toDetailsResult(await hotelApi.details(hotelCode));
    this.cache.set(hotelCode, { data, at: Date.now() });
    return data;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}

let instance: HotelDetailsService | null = null;

export function getHotelDetailsService(): HotelDetailsService {
  if (!instance) instance = new HotelDetailsService();
  return instance;
}

export function resetHotelDetailsService(): void {
  instance = null;
}

export default getHotelDetailsService();
