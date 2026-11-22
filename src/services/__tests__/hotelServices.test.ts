/**
 * Hotel services against the TravelSphere hotel API (mocked at the HTTP client):
 * search mapping and filters, details caching, prebook outcomes, booking completion and booking management.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../apiClient';

const api = vi.hoisted(() => vi.fn());
vi.mock('../apiClient', async importOriginal => ({ ...(await importOriginal<typeof import('../apiClient')>()), api }));

import { HotelSearchService, matchesMealPlan, toHotelResult } from '../hotelSearchService';
import { HotelDetailsService } from '../hotelDetailsService';
import { preBookService } from '../preBookService';
import { hotelBookingService } from '../hotelBookingService';
import { bookingManagementService } from '../bookingManagementService';
import { criteria, hotelResult, preBookResult, searchHit } from '../../tests/hotelFixtures';

beforeEach(() => {
  api.mockReset();
  localStorage.clear();
  hotelBookingService.cancelSession();
});

describe('hotel search', () => {
  it('sends city, country, local dates and children ages, and maps the cheapest offer', async () => {
    api.mockResolvedValue({ hotels: [searchHit(), searchHit({ hotelId: 'no-offers', offers: [] })], sandbox: true, nights: 2, rooms: 1 });
    const c = criteria({ paxRooms: [{ adults: 2, children: 1, childrenAges: [7] }] });
    const result = await new HotelSearchService().search(c);

    const [path, init] = api.mock.calls[0];
    expect(path).toBe('/v1/hotels/search');
    expect(init.body).toMatchObject({ city: 'Paris', country_code: 'FR', guest_nationality: 'IN',
      rooms: [{ adults: 2, children: [7] }] });
    expect(init.body.checkin).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.sandbox).toBe(true);
    expect(result.hotels).toHaveLength(1);
    expect(result.hotels[0]).toMatchObject({ bookingCode: 'offer-cheap', hotelCode: 'lp1897', nights: 2,
      price: { currency: 'EUR', offeredPrice: 180.5 }, mealType: 'Room Only', refundable: false });
  });

  it('validates input before calling the API', async () => {
    const svc = new HotelSearchService();
    await expect(svc.search(criteria({ city: ' ' }))).rejects.toThrow('City is required');
    await expect(svc.search(criteria({ countryCode: 'FRA' }))).rejects.toThrow('2-letter');
    await expect(svc.search(criteria({ checkOut: criteria().checkIn }))).rejects.toThrow('after check-in');
    await expect(svc.search(criteria({ paxRooms: [{ adults: 0, children: 0, childrenAges: [] }] }))).rejects.toThrow('adult');
    expect(api).not.toHaveBeenCalled();
  });

  it('filters by refundability, stars, meal plan and name', () => {
    const svc = new HotelSearchService();
    const hotels = [
      hotelResult(),
      hotelResult({ hotelCode: 'b', hotelName: 'Breakfast Inn', starRating: 3, refundable: true, mealType: 'Breakfast Included' }),
      hotelResult({ hotelCode: 'c', hotelName: 'Board House', starRating: 5, mealType: 'Half Board' }),
    ];
    expect(svc.filterResults(hotels, { refundable: true }).map(h => h.hotelCode)).toEqual(['b']);
    expect(svc.filterResults(hotels, { starRating: 5 }).map(h => h.hotelCode)).toEqual(['c']);
    expect(svc.filterResults(hotels, { mealPlan: 'breakfast' }).map(h => h.hotelCode)).toEqual(['b']);
    expect(svc.filterResults(hotels, { hotelName: 'lumi' }).map(h => h.hotelCode)).toEqual(['lp1897']);
    expect(matchesMealPlan('Bed and Breakfast', 'breakfast')).toBe(true);
    expect(matchesMealPlan('Half Board (breakfast and dinner)', 'breakfast')).toBe(false);
  });

  it('maps a hit without a photo to an empty picture rather than a stock image', () => {
    expect(toHotelResult(searchHit({ photo: null }), 1).hotelPicture).toBe('');
  });
});

describe('hotel details', () => {
  it('maps and caches details per hotel', async () => {
    api.mockResolvedValue({ hotel: { hotelId: 'lp1897', name: 'Hotel Lumière', description: 'Near the Louvre.', address: 'x',
      city: 'Paris', countryCode: 'FR', starRating: 4, images: ['a.jpg'], facilities: ['Wi-Fi'], latitude: 48.8, longitude: 2.3,
      checkinTime: '15:00', checkoutTime: '11:00', importantInformation: null } });
    const svc = new HotelDetailsService();
    const d = await svc.getHotelDetails('lp1897');
    await svc.getHotelDetails('lp1897');
    expect(api).toHaveBeenCalledTimes(1);
    expect(d).toMatchObject({ description: 'Near the Louvre.', facilities: ['Wi-Fi'], policy: { checkInTime: '15:00' },
      location: { latitude: 48.8, longitude: 2.3 } });
  });
});

describe('prebook', () => {
  it('reports price changes against the price the traveller saw', async () => {
    api.mockResolvedValue({ prebook: { prebookId: 'pb-9', offerId: 'o', hotelId: 'h', price: 190.5, currency: 'EUR',
      priceDifferencePercent: 5, cancellationChanged: true, boardChanged: false, refundable: false, cancellation: 'Non-refundable' } });
    const r = await preBookService.preBook('o', 180.5);
    expect(r).toMatchObject({ prebookId: 'pb-9', priceChanged: true, priceIncrease: 10, available: true,
      cancellationPolicyChanged: true });
  });

  it('treats an expired offer as unavailable and rethrows other errors', async () => {
    api.mockRejectedValueOnce(new ApiError(410, 'offer_expired', 'gone'));
    expect(await preBookService.preBook('o', 100)).toMatchObject({ available: false, prebookId: null });
    api.mockRejectedValueOnce(new ApiError(503, 'hotels_not_configured', 'no key'));
    await expect(preBookService.preBook('o', 100)).rejects.toThrow('no key');
  });
});

describe('booking session and completion', () => {
  const guests = [{ roomIndex: 0, customerNames: [
    { title: 'Ms', firstName: 'Asha', lastName: 'Rao', type: 'Adult' as const },
    { title: 'Mr', firstName: 'Ravi', lastName: 'Rao', type: 'Adult' as const }] }];
  const payment = { method: 'credit_card' as const, emailId: 'asha@example.test', phoneNumber: '+91 98765 43210' };

  it('restores the session after a reload', () => {
    hotelBookingService.startBooking(hotelResult(), criteria());
    hotelBookingService.updateSession({ status: 'guest_details' });
    // simulate a reload: drop the in-memory copy, keep storage
    (hotelBookingService as any).currentSession = null;
    const restored = hotelBookingService.getCurrentSession();
    expect(restored?.status).toBe('guest_details');
    expect(restored?.searchCriteria.checkIn).toBeInstanceOf(Date);
  });

  it('requires a verified price before booking', async () => {
    hotelBookingService.startBooking(hotelResult(), criteria());
    await expect(hotelBookingService.completeBooking(guests, payment)).rejects.toThrow('verified');
    expect(api).not.toHaveBeenCalled();
  });

  it('books with the prebook id, lead guest per room and holder contact', async () => {
    hotelBookingService.startBooking(hotelResult(), criteria());
    hotelBookingService.updateSession({ preBookResult: preBookResult() });
    api.mockResolvedValue({ recorded: true, booking: { booking_id: 'V8mglw-im', hotel_name: 'Hotel Lumière', price: '180.50',
      currency: 'EUR', status: 'CONFIRMED', sandbox: true } });

    const c = await hotelBookingService.completeBooking(guests, payment);
    const [path, init] = api.mock.calls[0];
    expect(path).toBe('/v1/hotels/book');
    expect(init.body).toMatchObject({ prebook_id: 'pb-1', hotel: { id: 'lp1897', country_code: 'FR' }, guests_count: 2,
      holder: { first_name: 'Asha', last_name: 'Rao', email: 'asha@example.test' },
      guests: [{ first_name: 'Asha', last_name: 'Rao' }] });
    expect(c).toMatchObject({ confirmationNumber: 'V8mglw-im', totalFare: 180.5, sandbox: true });
    expect(hotelBookingService.getCurrentSession()?.status).toBe('confirmed');
    expect(JSON.parse(localStorage.getItem('hotel_bookings')!)[0].confirmationNumber).toBe('V8mglw-im');
  });
});

describe('booking management', () => {
  const stored = { booking_id: 'V8mglw-im', hotel_id: 'lp1897', hotel_name: 'Hotel Lumière', city: 'Paris', country_code: 'FR',
    checkin: '2027-03-10', checkout: '2027-03-12', rooms: 1, guests: 2, room_name: 'Deluxe Room', board_name: 'Breakfast',
    price: '240.00', currency: 'EUR', refundable: true, status: 'CONFIRMED', cancellation_fee: null, refund_amount: null,
    sandbox: true, holder_name: 'Asha Rao', created_at: '2027-01-02T10:00:00Z' };

  it('lists and shows bookings with live provider details', async () => {
    api.mockResolvedValueOnce({ bookings: [stored] });
    const list = await bookingManagementService.getBookingsByDateRange('2027-01-01', '2027-12-31');
    expect(list.bookings[0]).toMatchObject({ confirmationNumber: 'V8mglw-im', bookingStatus: 'Confirmed', totalFare: 240 });

    api.mockResolvedValueOnce({ booking: { ...stored, provider: { bookingId: 'V8mglw-im', status: 'CONFIRMED', price: 240,
      currency: 'EUR', checkin: '2027-03-10', checkout: '2027-03-12', hotelName: 'Hotel Lumière', hotelConfirmationCode: null,
      rooms: [{ roomName: 'Deluxe Room', boardName: 'Breakfast', adults: 2, children: 0, guestName: 'Asha Rao' }],
      holder: null, cancellation: 'Free cancellation until 2027-03-08 12:00' } } });
    const d = await bookingManagementService.getBookingDetails('V8mglw-im');
    expect(d).toMatchObject({ roomName: 'Deluxe Room', cancellationPolicy: 'Free cancellation until 2027-03-08 12:00' });
    expect(d.guestDetails[0].customerNames[0]).toMatchObject({ firstName: 'Asha', lastName: 'Rao' });
  });

  it('cancels and explains the refund', async () => {
    api.mockResolvedValue({ cancellation: { bookingId: 'V8mglw-im', status: 'CANCELLED_WITH_CHARGES', cancellationFee: 40,
      refundAmount: 200, currency: 'EUR' } });
    const r = await bookingManagementService.cancelBooking('V8mglw-im');
    expect(r).toMatchObject({ success: true, cancellationCharge: 40, refundAmount: 200, cancellationStatus: 'Cancelled' });
    expect(r.message).toContain('EUR 40.00');
  });

  it('validates date ranges', async () => {
    await expect(bookingManagementService.getBookingsByDateRange('2027-02-01', '2027-01-01')).rejects.toThrow('before');
    await expect(bookingManagementService.getBookingsByDateRange('01/02/2027', '2027-01-01')).rejects.toThrow('format');
  });
});
