/**
 * Pre-Booking Service
 * 
 * Validates hotel availability and pricing before final booking by calling
 * the TBO Hotel API PreBook endpoint. Detects price changes and room
 * availability issues.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { getTboHotelApiClient } from './api/tboHotelApiClient';
import { mockFallbackHandler } from './mockFallbackHandler';
import type { PreBookRequest, PreBookResponse } from '../types/tboHotelApi';

// ============================================================================
// Types
// ============================================================================

export interface PreBookResult {
  bookingCode: string;
  originalPrice: number;
  currentPrice: number;
  priceChanged: boolean;
  priceIncrease: number;
  available: boolean;
  currency: string;
  cancellationPolicyChanged: boolean;
}

// ============================================================================
// Pre-Booking Service Class
// ============================================================================

class PreBookService {
  private get apiClient() {
    return getTboHotelApiClient();
  }

  /**
   * Pre-book a selected hotel room to validate current pricing and availability
   */
  async preBook(
    bookingCode: string,
    originalPriceOrPaymentMode?: number | string,
    paymentModeArg: string = 'Limit'
  ): Promise<PreBookResult> {
    let originalPrice = 0;
    let paymentMode = 'Limit';

    if (typeof originalPriceOrPaymentMode === 'number') {
      originalPrice = originalPriceOrPaymentMode;
      paymentMode = paymentModeArg;
    } else if (typeof originalPriceOrPaymentMode === 'string') {
      paymentMode = originalPriceOrPaymentMode;
    }

    if (originalPrice <= 0) {
      try {
        const { hotelBookingService } = await import('./hotelBookingService');
        const session = hotelBookingService.getCurrentSession();
        if (session?.hotel) {
          const hp = (session.hotel as any).price;
          if (typeof hp === 'number') {
            originalPrice = hp;
          } else if (hp && typeof hp === 'object') {
            originalPrice = hp.offeredPrice ?? hp.publishedPrice ?? hp.roomPrice ?? hp.OfferedPrice ?? hp.PublishedPrice ?? 0;
          }
        }
      } catch {
        // ignore
      }
    }

    try {
      // Build pre-book request (Requirement 3.1)
      const request: PreBookRequest = {
        BookingCode: bookingCode,
        PaymentMode: paymentMode,
      };

      // Call pre-book API
      const response: PreBookResponse = await this.apiClient.preBook(request);

      // Check for API errors or unsuccessful status
      if (response && (response.Status === 0 || response.Status === 2)) {
        const errorMessage = response.Message || 'Pre-booking failed';
        
        // Check if error indicates room unavailability (Requirement 3.4)
        if (
          errorMessage.toLowerCase().includes('not available') ||
          errorMessage.toLowerCase().includes('sold out') ||
          errorMessage.toLowerCase().includes('no longer available') ||
          errorMessage.toLowerCase().includes('unavailable')
        ) {
          return {
            bookingCode,
            originalPrice,
            currentPrice: 0,
            priceChanged: true,
            priceIncrease: 0,
            available: false,
            currency: 'INR',
            cancellationPolicyChanged: false,
          };
        }

        throw new Error(`Pre-booking failed: ${errorMessage}`);
      }

      // Extract current price from response
      const roomsDetails = (response as any)?.HotelRoomsDetails?.[0];
      const currentPrice =
        response?.HotelDetails?.Price?.OfferedPrice ??
        response?.HotelDetails?.Price?.PublishedPrice ??
        roomsDetails?.Price?.OfferedPrice ??
        roomsDetails?.Price?.PublishedPrice ??
        (response as any)?.Price?.OfferedPrice ??
        (response as any)?.Price?.PublishedPrice ??
        originalPrice;
      const currency =
        response?.HotelDetails?.Price?.CurrencyCode ??
        roomsDetails?.Price?.CurrencyCode ??
        (response as any)?.Price?.CurrencyCode ??
        'USD';
      if (originalPrice <= 0) {
        originalPrice = currentPrice;
      }

      const priceChanged =
        response?.IsPriceChanged !== undefined
          ? response.IsPriceChanged
          : (currentPrice !== originalPrice);
      const cancellationPolicyChanged = response?.IsCancellationPolicyChanged ?? false;
      
      // Calculate price difference (Requirement 3.2)
      const priceIncrease = currentPrice - originalPrice;

      return {
        bookingCode: response?.BookingCode || `${bookingCode}-PREBOOK`,
        originalPrice,
        currentPrice,
        priceChanged,
        priceIncrease,
        available: true,
        currency,
        cancellationPolicyChanged,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Room no longer available')) {
          throw error;
        }

        // Mock fallback for API timeout failures
        if (
          error.message.includes('API timeout') ||
          error.message.includes('timeout')
        ) {
          const mockResp = mockFallbackHandler.getMockPreBookResponse(
            bookingCode,
            originalPrice || 100
          );
          return {
            bookingCode: mockResp.BookingCode,
            originalPrice: originalPrice || mockResp.HotelDetails.Price.OfferedPrice,
            currentPrice: mockResp.HotelDetails.Price.OfferedPrice,
            priceChanged: mockResp.IsPriceChanged,
            priceIncrease: 0,
            available: true,
            currency: mockResp.HotelDetails.Price.CurrencyCode,
            cancellationPolicyChanged: mockResp.IsCancellationPolicyChanged,
          };
        }

        // Check if error indicates room unavailability (Requirement 3.4)
        if (
          error.message.toLowerCase().includes('not available') ||
          error.message.toLowerCase().includes('sold out') ||
          error.message.toLowerCase().includes('no longer available') ||
          error.message.toLowerCase().includes('unavailable')
        ) {
          return {
            bookingCode,
            originalPrice,
            currentPrice: 0,
            priceChanged: true,
            priceIncrease: 0,
            available: false,
            currency: 'INR',
            cancellationPolicyChanged: false,
          };
        }
      }

      // Re-throw other errors
      throw error;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const preBookService = new PreBookService();
export default preBookService;
