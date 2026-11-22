/**
 * The traveller's own hotel bookings: list, details (live status from the provider) and cancellation.
 */

import { hotelApi, type StoredBooking } from './hotelApi';

export interface GuestInfo {
  customerNames: {
    title: string;
    firstName: string;
    lastName: string;
    type: 'Adult' | 'Child';
  }[];
}

export interface BookingSummaryResult {
  confirmationNumber: string;
  bookingReferenceId: string;
  hotelName: string;
  checkInDate: Date;
  checkOutDate: Date;
  bookingStatus: string;
  totalFare: number;
  currency: string;
  sandbox: boolean;
}

export interface BookingDetailsResult extends BookingSummaryResult {
  bookingId: string;
  status: string;
  roomName: string | null;
  boardName: string | null;
  guestDetails: GuestInfo[];
  bookedOn: Date;
  cancellationPolicy: string;
  hotelConfirmationCode: string | null;
  voucherUrl?: string;
}

export interface BookingListResult {
  bookings: BookingSummaryResult[];
  totalCount: number;
}

export interface CancellationResult {
  success: boolean;
  confirmationNumber: string;
  cancellationStatus: string;
  refundAmount: number;
  cancellationCharge: number;
  message: string;
}

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  CANCELED: 'Cancelled',
  CANCELLED_WITH_CHARGES: 'Cancelled',
};
const label = (s: string) => STATUS_LABEL[s?.toUpperCase()] ?? s ?? 'Unknown';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`);

const summary = (b: StoredBooking): BookingSummaryResult => ({
  confirmationNumber: b.booking_id,
  bookingReferenceId: b.booking_id,
  hotelName: b.hotel_name,
  checkInDate: day(b.checkin),
  checkOutDate: day(b.checkout),
  bookingStatus: label(b.status),
  totalFare: Number(b.price),
  currency: b.currency,
  sandbox: b.sandbox,
});

class BookingManagementService {
  async getBookingDetails(confirmationNumber: string): Promise<BookingDetailsResult> {
    if (!confirmationNumber?.trim()) throw new Error('A confirmation number is required');
    const b = await hotelApi.booking(confirmationNumber.trim());
    const p = b.provider;
    const guestDetails: GuestInfo[] = (p.rooms.length ? p.rooms : [{ guestName: b.holder_name }]).map(r => {
      const [firstName, ...rest] = (r.guestName || b.holder_name).split(' ');
      return { customerNames: [{ title: '', firstName, lastName: rest.join(' '), type: 'Adult' as const }] };
    });
    return {
      ...summary(b),
      bookingStatus: label(p.status || b.status),
      bookingId: b.booking_id,
      status: p.status || b.status,
      roomName: p.rooms[0]?.roomName ?? b.room_name,
      boardName: p.rooms[0]?.boardName ?? b.board_name,
      guestDetails,
      bookedOn: new Date(b.created_at),
      cancellationPolicy: p.cancellation,
      hotelConfirmationCode: p.hotelConfirmationCode,
    };
  }

  async getBookingsByDateRange(fromDate: string, toDate: string): Promise<BookingListResult> {
    if (!DATE.test(fromDate) || !DATE.test(toDate)) throw new Error('Invalid date format. Expected YYYY-MM-DD');
    if (fromDate > toDate) throw new Error('From date must be before or equal to to date');
    const bookings = (await hotelApi.bookings(fromDate, toDate)).map(summary);
    return { bookings, totalCount: bookings.length };
  }

  async cancelBooking(confirmationNumber: string): Promise<CancellationResult> {
    if (!confirmationNumber?.trim()) throw new Error('Confirmation number is required for cancellation');
    const c = await hotelApi.cancel(confirmationNumber.trim());
    const charged = c.cancellationFee > 0;
    return {
      success: true,
      confirmationNumber: c.bookingId,
      cancellationStatus: label(c.status),
      refundAmount: c.refundAmount,
      cancellationCharge: c.cancellationFee,
      message: charged
        ? `Booking cancelled. A cancellation fee of ${c.currency} ${c.cancellationFee.toFixed(2)} applies; refund ${c.currency} ${c.refundAmount.toFixed(2)}.`
        : `Booking cancelled. Refund: ${c.currency} ${c.refundAmount.toFixed(2)}.`,
    };
  }
}

export const bookingManagementService = new BookingManagementService();
export default bookingManagementService;
