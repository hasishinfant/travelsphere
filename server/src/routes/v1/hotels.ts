// Hotel search and booking through the hotel provider (LiteAPI). The provider key never leaves the server.
// Bookings are recorded per traveller in hotel_bookings; only the owner can view or cancel them.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Db } from '../../db.js';
import { withUser } from '../../db.js';
import { HttpError, parse, route } from '../../http.js';
import type { HotelProvider } from '../../integrations/liteapi.js';
import { Page, pageMeta } from './common.js';

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Not a real calendar date');
const COUNTRY = z.string().regex(/^[A-Za-z]{2}$/, 'Use a 2-letter country code').transform(s => s.toUpperCase());
const HOTEL_ID = z.string().regex(/^[A-Za-z0-9_-]{1,60}$/, 'Invalid hotel id');
const BOOKING_ID = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, 'Invalid booking id');
const NAME = z.string().trim().min(1).max(80);
const today = () => new Date().toISOString().slice(0, 10);
const nights = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

const Room = z.object({
  adults: z.number().int().min(1).max(8),
  children: z.array(z.number().int().min(0).max(17)).max(4).default([]),
}).strict();

const Search = z.object({
  city: z.string().trim().min(1).max(120).optional(),
  country_code: COUNTRY.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radius_m: z.number().int().min(1000).max(50_000).optional(),
  checkin: ISO_DATE,
  checkout: ISO_DATE,
  rooms: z.array(Room).min(1).max(5),
  currency: z.string().regex(/^[A-Za-z]{3}$/).transform(s => s.toUpperCase()).default('USD'),
  guest_nationality: COUNTRY.default('US'),
}).strict()
  .refine(b => (b.city && b.country_code) || (b.latitude !== undefined && b.longitude !== undefined),
    { message: 'Provide city and country_code, or latitude and longitude', path: ['city'] })
  .refine(b => b.checkin >= today(), { message: 'Check-in cannot be in the past', path: ['checkin'] })
  .refine(b => b.checkout > b.checkin, { message: 'Check-out must be after check-in', path: ['checkout'] })
  .refine(b => nights(b.checkin, b.checkout) <= 30, { message: 'Stays are limited to 30 nights', path: ['checkout'] });

const Prebook = z.object({ offer_id: z.string().min(1).max(4000) }).strict();

const Book = z.object({
  prebook_id: z.string().min(1).max(200),
  hotel: z.object({
    id: HOTEL_ID,
    name: z.string().trim().min(1).max(300),
    city: z.string().trim().max(120).optional(),
    country_code: COUNTRY.optional(),
  }).strict(),
  checkin: ISO_DATE,
  checkout: ISO_DATE,
  room_name: z.string().trim().max(300).optional(),
  board_name: z.string().trim().max(120).optional(),
  refundable: z.boolean().optional(),
  guests_count: z.number().int().min(1).max(40),
  holder: z.object({
    first_name: NAME, last_name: NAME,
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'Invalid phone number'),
  }).strict(),
  // Lead guest for each room, in room order
  guests: z.array(z.object({ first_name: NAME, last_name: NAME }).strict()).min(1).max(5),
}).strict().refine(b => b.checkout > b.checkin, { message: 'Check-out must be after check-in', path: ['checkout'] });

const ListQuery = Page.extend({ from: ISO_DATE.optional(), to: ISO_DATE.optional() }).strict();

const BOOKING_COLUMNS = `provider_booking_id as booking_id, hotel_id, hotel_name, city, country_code, checkin, checkout,
  rooms, guests, room_name, board_name, price, currency, refundable, status, cancellation_fee, refund_amount, sandbox,
  holder_name, created_at`;

export function hotelsRouter(db: Db, provider: HotelProvider | null, opts: { allowLiveBookings: boolean }) {
  const r = Router();
  const perUser = (windowMs: number, limit: number) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8',
    legacyHeaders: false, keyGenerator: req => req.user?.id ?? ipKeyGenerator(req.ip ?? '') });
  const searchLimiter = perUser(60_000, 30);
  const bookLimiter = perUser(15 * 60_000, 10);

  const need = (): HotelProvider => {
    if (!provider) {
      throw new HttpError(503, 'hotels_not_configured',
        'Hotel booking is not configured. Add LITEAPI_API_KEY to server/.env (free sandbox key at connect.nuitee.com).');
    }
    return provider;
  };
  const liveAllowed = () => opts.allowLiveBookings;

  r.get('/status', (_req, res) => {
    res.json({ configured: !!provider, environment: provider?.env ?? null,
      live_bookings_enabled: !!provider && provider.env === 'production' && liveAllowed() });
  });

  r.post('/search', searchLimiter, route(async (req, res) => {
    const b = parse(Search, req.body);
    const result = await need().search({
      checkin: b.checkin, checkout: b.checkout, currency: b.currency, guestNationality: b.guest_nationality,
      occupancies: b.rooms.map(x => ({ adults: x.adults, children: x.children })),
      cityName: b.city, countryCode: b.country_code, latitude: b.latitude, longitude: b.longitude, radiusM: b.radius_m,
    });
    res.json({ hotels: result.hotels, sandbox: result.sandbox ?? provider!.env === 'sandbox',
      nights: nights(b.checkin, b.checkout), rooms: b.rooms.length });
  }));

  r.post('/prebook', searchLimiter, route(async (req, res) => {
    const { offer_id } = parse(Prebook, req.body);
    const p = need();
    const result = await p.prebook(offer_id);
    // A production account used in sandbox mode would create real reservations — stop before booking
    if (result.sandbox === false && !liveAllowed()) {
      throw new HttpError(403, 'live_booking_disabled',
        'The hotel provider account is in live mode and live bookings are disabled on this server');
    }
    res.json({ prebook: result });
  }));

  r.post('/book', bookLimiter, route(async (req, res) => {
    const b = parse(Book, req.body);
    const p = need();
    if (p.env === 'production' && !liveAllowed()) {
      throw new HttpError(403, 'live_booking_disabled', 'Live hotel bookings are disabled on this server');
    }
    const holder = { firstName: b.holder.first_name, lastName: b.holder.last_name, email: b.holder.email, phone: b.holder.phone };
    const clientReference = `ts-${randomUUID()}`;
    const booking = await p.book({
      prebookId: b.prebook_id, clientReference, holder,
      guests: b.guests.map((g, i) => ({ occupancyNumber: i + 1, firstName: g.first_name, lastName: g.last_name, email: b.holder.email })),
    });

    const row = {
      booking_id: booking.bookingId, hotel_id: b.hotel.id, hotel_name: booking.hotelName ?? b.hotel.name,
      city: b.hotel.city ?? null, country_code: b.hotel.country_code ?? null,
      checkin: booking.checkin || b.checkin, checkout: booking.checkout || b.checkout,
      rooms: b.guests.length, guests: b.guests_count, room_name: b.room_name ?? null, board_name: b.board_name ?? null,
      price: booking.price, currency: booking.currency, refundable: b.refundable ?? null,
      status: booking.status === 'CONFIRMED' ? 'CONFIRMED' : booking.status, sandbox: booking.sandbox ?? p.env === 'sandbox',
      holder_name: `${holder.firstName} ${holder.lastName}`,
    };
    // The provider holds the reservation; record it for the traveller. A failure here must not hide the booking.
    let recorded = true;
    try {
      await db.query(
        `insert into public.hotel_bookings (user_id, provider_booking_id, client_reference, hotel_id, hotel_name, city,
           country_code, checkin, checkout, rooms, guests, room_name, board_name, price, currency, refundable, status,
           sandbox, holder_name, holder_email)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [req.user!.id, row.booking_id, clientReference, row.hotel_id, row.hotel_name, row.city, row.country_code,
          row.checkin, row.checkout, row.rooms, row.guests, row.room_name, row.board_name, row.price, row.currency,
          row.refundable, row.status, row.sandbox, row.holder_name, holder.email]);
    } catch (err) {
      recorded = false;
      console.error(`[hotels] booking ${booking.bookingId} confirmed but not recorded:`, (err as Error).message);
    }
    res.status(201).json({ booking: row, recorded });
  }));

  r.get('/bookings', route(async (req, res) => {
    const q = parse(ListQuery, req.query);
    const bookings = await withUser(db, req.user!.id, async tx => (await tx.query(
      `select ${BOOKING_COLUMNS} from public.hotel_bookings
       where user_id = auth.uid() and ($1::date is null or checkout >= $1) and ($2::date is null or checkin <= $2)
       order by checkin desc limit $3 offset $4`, [q.from ?? null, q.to ?? null, q.limit, q.offset])).rows);
    res.json({ bookings, page: pageMeta(q.limit, q.offset, bookings.length) });
  }));

  const own = async (userId: string, bookingId: string) => withUser(db, userId, async tx =>
    (await tx.query(`select ${BOOKING_COLUMNS} from public.hotel_bookings
                     where user_id = auth.uid() and provider_booking_id = $1`, [bookingId])).rows[0]);

  r.get('/bookings/:bookingId', route(async (req, res) => {
    const id = parse(BOOKING_ID, req.params.bookingId);
    const stored = await own(req.user!.id, id);
    if (!stored) throw new HttpError(404, 'not_found', 'Booking not found');
    const live = await need().getBooking(id);
    if (live.status && live.status !== stored.status && ['CONFIRMED', 'CANCELLED', 'CANCELLED_WITH_CHARGES'].includes(live.status)) {
      await db.query('update public.hotel_bookings set status = $2 where provider_booking_id = $1', [id, live.status]);
      stored.status = live.status;
    }
    res.json({ booking: { ...stored, provider: live } });
  }));

  r.post('/bookings/:bookingId/cancel', bookLimiter, route(async (req, res) => {
    const id = parse(BOOKING_ID, req.params.bookingId);
    const stored = await own(req.user!.id, id);
    if (!stored) throw new HttpError(404, 'not_found', 'Booking not found');
    if (stored.status !== 'CONFIRMED') throw new HttpError(409, 'already_cancelled', 'This booking is already cancelled');
    const result = await need().cancel(id);
    await db.query(
      `update public.hotel_bookings set status = $2, cancellation_fee = $3, refund_amount = $4 where provider_booking_id = $1`,
      [id, ['CANCELLED', 'CANCELLED_WITH_CHARGES'].includes(result.status) ? result.status : 'CANCELLED',
        result.cancellationFee, result.refundAmount]);
    res.json({ cancellation: result });
  }));

  r.get('/:hotelId', route(async (req, res) => {
    const hotelId = parse(HOTEL_ID, req.params.hotelId);
    res.json({ hotel: await need().details(hotelId) });
  }));

  return r;
}
