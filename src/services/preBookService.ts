/**
 * Pre-booking: confirms the selected room is still available and returns the final price and terms before the
 * traveller enters guest details. The prebook id it returns is required to book.
 */

import { ApiError } from './apiClient';
import { hotelApi } from './hotelApi';

export interface PreBookResult {
  /** Offer that was verified. */
  bookingCode: string;
  /** Provider prebook id — required to complete the booking. Null when the room is unavailable. */
  prebookId: string | null;
  originalPrice: number;
  currentPrice: number;
  priceChanged: boolean;
  priceIncrease: number;
  available: boolean;
  currency: string;
  cancellationPolicyChanged: boolean;
  boardChanged: boolean;
  refundable: boolean;
  cancellationPolicy: string;
}

class PreBookService {
  /**
   * @param bookingCode   offer id of the selected room
   * @param originalPrice price shown to the traveller in search results (to report the difference)
   */
  async preBook(bookingCode: string, originalPrice?: number): Promise<PreBookResult> {
    if (!bookingCode) throw new Error('A room must be selected before verifying the price');
    try {
      const p = await hotelApi.prebook(bookingCode);
      const shown = originalPrice ?? p.price;
      const increase = Math.round((p.price - shown) * 100) / 100;
      return {
        bookingCode,
        prebookId: p.prebookId,
        originalPrice: shown,
        currentPrice: p.price,
        priceChanged: p.priceDifferencePercent !== 0 || Math.abs(increase) >= 0.01,
        priceIncrease: increase,
        available: true,
        currency: p.currency,
        cancellationPolicyChanged: p.cancellationChanged,
        boardChanged: p.boardChanged,
        refundable: p.refundable,
        cancellationPolicy: p.cancellation,
      };
    } catch (err) {
      if (err instanceof ApiError && err.code === 'offer_expired') {
        return {
          bookingCode, prebookId: null, originalPrice: originalPrice ?? 0, currentPrice: originalPrice ?? 0,
          priceChanged: false, priceIncrease: 0, available: false, currency: '', cancellationPolicyChanged: false,
          boardChanged: false, refundable: false, cancellationPolicy: '',
        };
      }
      throw err;
    }
  }
}

export const preBookService = new PreBookService();
export default preBookService;
