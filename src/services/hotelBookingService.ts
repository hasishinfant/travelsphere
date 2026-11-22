/**
 * Hotel booking session (select room → verify price → guest details → confirm) and booking completion through the
 * TravelSphere API. The session survives page reloads for 30 minutes.
 */

import { hotelApi, ymd } from './hotelApi';
import type { HotelResult, HotelSearchCriteria } from './hotelSearchService';
import type { PreBookResult } from './preBookService';

export type { HotelSearchCriteria } from './hotelSearchService';

export type HotelBookingStatus = 'details' | 'prebook' | 'guest_details' | 'payment' | 'confirmed';

export interface CustomerName {
  title: string;
  firstName: string;
  lastName: string;
  type: 'Adult' | 'Child';
}

export interface GuestDetails {
  roomIndex: number;
  customerNames: CustomerName[];
}

export interface PaymentInfo {
  method: 'credit_card' | 'debit_card' | 'upi' | 'net_banking';
  emailId?: string;
  phoneNumber?: string;
}

export interface HotelBookingConfirmation {
  confirmationNumber: string;
  bookingReferenceId: string;
  hotel: HotelResult;
  hotelName: string;
  guestDetails: GuestDetails[];
  totalFare: number;
  currency: string;
  checkIn: Date;
  checkOut: Date;
  bookedAt: Date;
  status: string;
  /** True for provider sandbox bookings: simulated, nothing charged. */
  sandbox: boolean;
  cancellationPolicy: string;
}

export interface HotelBookingSession {
  sessionId: string;
  hotel: HotelResult;
  searchCriteria: HotelSearchCriteria;
  /** Offer id of the selected room. */
  bookingCode: string;
  preBookResult?: PreBookResult;
  guestDetails?: GuestDetails[];
  paymentInfo?: PaymentInfo;
  confirmation?: HotelBookingConfirmation;
  status: HotelBookingStatus;
  createdAt: Date;
  expiresAt: Date;
}

const SESSION_TIMEOUT_MINUTES = 30;
const SESSION_STORAGE_KEY = 'hotel_booking_session';
const BOOKINGS_STORAGE_KEY = 'hotel_bookings';

const revive = (s: HotelBookingSession): HotelBookingSession => ({
  ...s,
  createdAt: new Date(s.createdAt),
  expiresAt: new Date(s.expiresAt),
  searchCriteria: { ...s.searchCriteria, checkIn: new Date(s.searchCriteria.checkIn), checkOut: new Date(s.searchCriteria.checkOut) },
  confirmation: s.confirmation && {
    ...s.confirmation,
    checkIn: new Date(s.confirmation.checkIn),
    checkOut: new Date(s.confirmation.checkOut),
    bookedAt: new Date(s.confirmation.bookedAt),
  },
});

class HotelBookingService {
  private currentSession: HotelBookingSession | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  startBooking(hotel: HotelResult, searchCriteria: HotelSearchCriteria): HotelBookingSession {
    this.cancelSession();
    const now = new Date();
    const session: HotelBookingSession = {
      sessionId: `hotel_session_${now.getTime()}_${Math.random().toString(36).slice(2, 11)}`,
      hotel,
      searchCriteria,
      bookingCode: hotel.bookingCode,
      status: 'details',
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TIMEOUT_MINUTES * 60_000),
    };
    this.currentSession = session;
    this.persist(session);
    this.scheduleTimeout();
    return session;
  }

  /** The active session, restored from storage after a reload; null when none or expired. */
  getCurrentSession(): HotelBookingSession | null {
    if (!this.currentSession) this.restoreSession();
    if (this.currentSession && new Date() > this.currentSession.expiresAt) {
      this.cancelSession();
      return null;
    }
    return this.currentSession;
  }

  updateSession(stepData: Partial<HotelBookingSession>): void {
    const session = this.getCurrentSession();
    if (!session) throw new Error('Your booking session has expired — please search again');
    this.currentSession = { ...session, ...stepData };
    this.persist(this.currentSession);
  }

  cancelSession(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.timeoutId = null;
    this.currentSession = null;
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  restoreSession(): HotelBookingSession | null {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const session = revive(JSON.parse(raw));
      if (new Date() > session.expiresAt) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      this.currentSession = session;
      this.scheduleTimeout();
      return session;
    } catch {
      return null;
    }
  }

  /** Book the verified room. Requires a successful pre-book in the session. */
  async completeBooking(guestDetails: GuestDetails[], paymentInfo: PaymentInfo): Promise<HotelBookingConfirmation> {
    const session = this.getCurrentSession();
    if (!session) throw new Error('Your booking session has expired — please search again');
    const pre = session.preBookResult;
    if (!pre?.available || !pre.prebookId) throw new Error('The price must be verified before booking');
    if (!paymentInfo.emailId || !paymentInfo.phoneNumber) throw new Error('Email and phone number are required');

    const leads = guestDetails.map(room => room.customerNames.find(c => c.type === 'Adult') ?? room.customerNames[0]);
    if (!leads.length || leads.some(l => !l?.firstName || !l?.lastName)) {
      throw new Error('Each room needs a lead guest name');
    }
    const { hotel, searchCriteria } = session;
    const { booking } = await hotelApi.book({
      prebook_id: pre.prebookId,
      hotel: { id: hotel.hotelCode, name: hotel.hotelName, city: hotel.cityName || undefined,
        country_code: /^[A-Za-z]{2}$/.test(hotel.countryName) ? hotel.countryName : undefined },
      checkin: ymd(searchCriteria.checkIn),
      checkout: ymd(searchCriteria.checkOut),
      room_name: hotel.roomType,
      board_name: hotel.mealType,
      refundable: pre.refundable,
      guests_count: searchCriteria.paxRooms.reduce((n, r) => n + r.adults + r.children, 0),
      holder: { first_name: leads[0].firstName.trim(), last_name: leads[0].lastName.trim(),
        email: paymentInfo.emailId.trim(), phone: paymentInfo.phoneNumber.trim() },
      guests: leads.map(l => ({ first_name: l.firstName.trim(), last_name: l.lastName.trim() })),
    });

    const confirmation: HotelBookingConfirmation = {
      confirmationNumber: booking.booking_id,
      bookingReferenceId: booking.booking_id,
      hotel,
      hotelName: booking.hotel_name,
      guestDetails,
      totalFare: Number(booking.price),
      currency: booking.currency,
      checkIn: searchCriteria.checkIn,
      checkOut: searchCriteria.checkOut,
      bookedAt: new Date(),
      status: booking.status,
      sandbox: booking.sandbox,
      cancellationPolicy: pre.cancellationPolicy,
    };
    this.updateSession({ status: 'confirmed', guestDetails, paymentInfo, confirmation });
    await this.addToItinerary(confirmation);
    return confirmation;
  }

  private async addToItinerary(c: HotelBookingConfirmation): Promise<void> {
    try {
      const { itineraryService } = await import('./itineraryService');
      itineraryService.addHotelBooking({
        confirmationNumber: c.confirmationNumber,
        bookingReferenceId: c.bookingReferenceId,
        hotelName: c.hotelName,
        address: c.hotel.address,
        cityName: c.hotel.cityName,
        countryName: c.hotel.countryName,
        starRating: c.hotel.starRating,
        checkIn: c.checkIn,
        checkOut: c.checkOut,
        roomType: c.hotel.roomType,
        mealType: c.hotel.mealType,
        guests: c.guestDetails.flatMap(r => r.customerNames.map(g => `${g.title} ${g.firstName} ${g.lastName}`)),
        totalFare: c.totalFare,
        currency: c.currency,
        status: c.status,
        bookedAt: c.bookedAt,
        refundable: c.hotel.refundable,
      });
      const stored = JSON.parse(localStorage.getItem(BOOKINGS_STORAGE_KEY) || '[]');
      localStorage.setItem(BOOKINGS_STORAGE_KEY, JSON.stringify([...(Array.isArray(stored) ? stored : []), c]));
    } catch (err) {
      // The booking itself succeeded; the itinerary is a convenience copy
      console.error('Failed to add hotel booking to the itinerary:', err);
    }
  }

  private persist(session: HotelBookingSession): void {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* storage unavailable */
    }
  }

  private scheduleTimeout(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (!this.currentSession) return;
    const ms = this.currentSession.expiresAt.getTime() - Date.now();
    if (ms > 0) this.timeoutId = setTimeout(() => this.cancelSession(), ms);
  }
}

export const hotelBookingService = new HotelBookingService();
export default hotelBookingService;
