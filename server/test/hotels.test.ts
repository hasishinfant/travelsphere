import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/http.js';
import type { RiskService } from '../src/integrations/riskService.js';
import { amountOf, createLiteApi, describeCancellation, type HotelProvider } from '../src/integrations/liteapi.js';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://localhost:5432/postgres';
const DB_URL = ADMIN_URL.replace(/\/[^/]*$/, '/travelsphere_api_test');
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: DB_URL, AUTH_MODE: 'local',
  LOCAL_JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long' });
const down = () => Promise.reject(new HttpError(503, 'risk_service_unavailable', 'down'));
const risk: RiskService = { health: async () => ({ status: 'ok' }), assessDestination: down, assessJourney: down };

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ provider client (fake fetch, documented shapes)
const RATES = {
  sandbox: true,
  data: [{
    hotelId: 'lp1897',
    roomTypes: [
      { offerId: 'offer-cheap', offerRetailRate: { amount: 180.5, currency: 'USD' },
        rates: [{ name: 'Standard King Room', boardName: 'Room Only', retailRate: { total: [{ amount: 180.5, currency: 'USD' }] },
          cancellationPolicies: { refundableTag: 'NRFN', cancelPolicyInfos: [] } }] },
      { offerId: 'offer-flex',
        rates: [{ name: 'Deluxe Room', boardName: 'Breakfast Included', retailRate: { total: [{ amount: 240, currency: 'USD' }] },
          cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [{ cancelTime: '2027-03-08T12:00:00', amount: 240 }] } }] },
    ],
  }, { hotelId: 'lp-empty', roomTypes: [] }],
};
const STATIC = { data: [{ id: 'lp1897', name: 'Hotel Lumière', address: '12 Rue de Rivoli', city: 'Paris', country: 'fr',
  stars: 4, rating: 8.7, main_photo: 'https://img.example/lp1897.jpg', latitude: 48.86, longitude: 2.34 }] };

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { method: string; url: string; body: any; key: string }[] = [];
  const fn = (async (url: string, init: any) => {
    calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined, key: init.headers['X-API-Key'] });
    const match = Object.keys(routes).find(k => `${init.method} ${url}`.startsWith(k));
    const r = match ? routes[match] : { status: 404, body: { error: { message: 'no route' } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const lite = (routes: Record<string, { status?: number; body: unknown }>) => {
  const f = fakeFetch(routes);
  return { api: createLiteApi({ apiKey: 'sand_test_key', env: 'sandbox', timeoutMs: 2000 }, f.fn), calls: f.calls };
};

describe('LiteAPI client', () => {
  it('searches by city, merges static content and sorts offers by price', async () => {
    const { api, calls } = lite({
      'POST https://api.liteapi.travel/v3.0/hotels/rates': { body: RATES },
      'GET https://api.liteapi.travel/v3.0/data/hotels': { body: STATIC },
    });
    const r = await api.search({ checkin: '2027-03-10', checkout: '2027-03-12', currency: 'USD', guestNationality: 'IN',
      occupancies: [{ adults: 2, children: [5] }], cityName: 'Paris', countryCode: 'FR' });
    expect(calls[0].key).toBe('sand_test_key');
    expect(calls[0].body).toMatchObject({ cityName: 'Paris', countryCode: 'FR', guestNationality: 'IN',
      occupancies: [{ adults: 2, children: [5] }] });
    expect(calls[1].url).toContain('hotelIds=lp1897');
    expect(r.sandbox).toBe(true);
    expect(r.hotels).toHaveLength(1);  // hotel without offers dropped
    expect(r.hotels[0]).toMatchObject({ hotelId: 'lp1897', name: 'Hotel Lumière', countryCode: 'FR', starRating: 4,
      photo: 'https://img.example/lp1897.jpg' });
    expect(r.hotels[0].offers.map(o => [o.offerId, o.price, o.refundable])).toEqual([
      ['offer-cheap', 180.5, false], ['offer-flex', 240, true]]);
    expect(r.hotels[0].offers[1].cancellation).toBe('Free cancellation until 2027-03-08 12:00');
  });

  it('normalises prebook, book, retrieve and cancel', async () => {
    const { api, calls } = lite({
      'POST https://book.liteapi.travel/v3.0/rates/prebook': { body: { data: { prebookId: 'pb-1', offerId: 'offer-flex',
        hotelId: 'lp1897', price: 252, currency: 'USD', priceDifferencePercent: 5, cancellationChanged: false, boardChanged: false,
        roomTypes: [{ rates: [{ cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [] } }] }] } } },
      'POST https://book.liteapi.travel/v3.0/rates/book': { body: { data: { bookingId: 'V8mglw-im', status: 'CONFIRMED',
        price: 252, currency: 'USD', checkin: '2027-03-10', checkout: '2027-03-12', hotel: { name: 'Hotel Lumière' } } } },
      'GET https://book.liteapi.travel/v3.0/bookings/V8mglw-im': { body: { data: { bookingId: 'V8mglw-im', status: 'CONFIRMED',
        price: 252, currency: 'USD', checkin: '2027-03-10', checkout: '2027-03-12', hotel: { hotelId: 'lp1897', name: 'Hotel Lumière' },
        bookedRooms: [{ roomType: { name: 'Deluxe Room' }, boardName: 'Breakfast Included', adults: 2, children: 0,
          firstName: 'Asha', lastName: 'Rao', rate: { retailRate: { total: { amount: 252, currency: 'USD' } } } }],
        holder: { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.test' } } } },
      'PUT https://book.liteapi.travel/v3.0/bookings/V8mglw-im': { body: { data: { bookingId: 'V8mglw-im', status: 'CANCELLED',
        cancellation_fee: 0, refund_amount: 252, currency: 'USD' } } },
    });
    const pb = await api.prebook('offer-flex');
    expect(pb).toMatchObject({ prebookId: 'pb-1', price: 252, priceDifferencePercent: 5, refundable: true });
    const bk = await api.book({ prebookId: 'pb-1', clientReference: 'ts-abc12345',
      holder: { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.test', phone: '+911234567890' },
      guests: [{ occupancyNumber: 1, firstName: 'Asha', lastName: 'Rao', email: 'asha@example.test' }] });
    expect(calls.at(-1)!.body.payment).toEqual({ method: 'ACC_CREDIT_CARD' });
    expect(bk).toMatchObject({ bookingId: 'V8mglw-im', status: 'CONFIRMED', hotelName: 'Hotel Lumière' });
    const got = await api.getBooking('V8mglw-im');
    expect(got.rooms[0]).toMatchObject({ roomName: 'Deluxe Room', guestName: 'Asha Rao', adults: 2 });
    expect(await api.cancel('V8mglw-im')).toMatchObject({ status: 'CANCELLED', refundAmount: 252 });
  });

  it('maps provider errors to clear API errors', async () => {
    const { api } = lite({
      'POST https://book.liteapi.travel/v3.0/rates/prebook': { status: 410, body: { error: { message: 'rate expired' } } },
      'GET https://api.liteapi.travel/v3.0/data/hotel': { status: 401, body: {} },
    });
    await expect(api.prebook('x')).rejects.toMatchObject({ status: 410, code: 'offer_expired' });
    await expect(api.details('lp1')).rejects.toMatchObject({ status: 503, code: 'hotels_not_configured' });
  });

  it('helpers handle both price shapes and cancellation tags', () => {
    expect(amountOf([{ amount: 10, currency: 'EUR' }])).toEqual({ amount: 10, currency: 'EUR' });
    expect(amountOf({ amount: 10, currency: 'EUR' })).toEqual({ amount: 10, currency: 'EUR' });
    expect(amountOf(null)).toBeNull();
    expect(describeCancellation({ refundableTag: 'NRFN' }).text).toBe('Non-refundable');
  });
});

// ------------------------------------------------------------------ routes (fake provider)
let db: Db;
const calls: string[] = [];
let prebookSandbox: boolean | null = true;
const fakeProvider = (env: 'sandbox' | 'production', sandboxKey = env === 'sandbox'): HotelProvider => ({
  env,
  sandboxKey,
  search: async () => ({ hotels: [], sandbox: env === 'sandbox' }),
  details: async id => ({ hotelId: id, name: 'Hotel Lumière', description: '', address: '', city: 'Paris', countryCode: 'FR',
    starRating: 4, images: [], facilities: [], latitude: null, longitude: null, checkinTime: null, checkoutTime: null,
    importantInformation: null }),
  prebook: async offerId => { calls.push(`prebook:${offerId}`); return { prebookId: `pb-${offerId}`, offerId, hotelId: 'lp1897',
    price: 240, currency: 'USD', priceDifferencePercent: 0, cancellationChanged: false, boardChanged: false, refundable: true,
    cancellation: 'Free cancellation', sandbox: prebookSandbox }; },
  book: async input => { calls.push(`book:${input.prebookId}`); return { bookingId: `bk-${input.prebookId}`, status: 'CONFIRMED',
    price: 240, currency: 'USD', checkin: inDays(30), checkout: inDays(32), hotelName: 'Hotel Lumière', sandbox: env === 'sandbox' }; },
  getBooking: async id => ({ bookingId: id, status: 'CONFIRMED', price: 240, currency: 'USD', checkin: inDays(30),
    checkout: inDays(32), hotelName: 'Hotel Lumière', hotelId: 'lp1897', hotelConfirmationCode: null, rooms: [], holder: null,
    cancellation: 'Free cancellation', createdAt: null, sandbox: true }),
  cancel: async id => { calls.push(`cancel:${id}`); return { bookingId: id, status: 'CANCELLED', cancellationFee: 0, refundAmount: 240, currency: 'USD' }; },
});
const appWith = (provider: HotelProvider | null, allowLive = false) =>
  createApp({ ...config, LITEAPI_ALLOW_LIVE_BOOKINGS: allowLive }, db, undefined, undefined, risk, provider);

const signIn = async (app: ReturnType<typeof createApp>, email: string) =>
  (await request(app).post('/api/auth/dev-session').send({ email })).body.token as string;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const bookBody = (prebook = 'pb-offer-1') => ({
  prebook_id: prebook, hotel: { id: 'lp1897', name: 'Hotel Lumière', city: 'Paris', country_code: 'fr' },
  checkin: inDays(30), checkout: inDays(32), room_name: 'Deluxe Room', board_name: 'Breakfast Included', refundable: true,
  guests_count: 2, holder: { first_name: 'Asha', last_name: 'Rao', email: 'Asha@Example.test', phone: '+91 98765 43210' },
  guests: [{ first_name: 'Asha', last_name: 'Rao' }],
});

beforeAll(() => { db = createPool(DB_URL); });
afterAll(async () => { await db.end(); });

describe('hotel routes', () => {
  it('report not configured without a key, and require sign-in', async () => {
    const app = appWith(null);
    expect((await request(app).post('/api/v1/hotels/search').send({})).status).toBe(401);
    const t = await signIn(app, 'hotels-nokey@example.test');
    expect((await request(app).get('/api/v1/hotels/status').set(as(t))).body).toMatchObject({ configured: false });
    const res = await request(app).get('/api/v1/hotels/lp1897').set(as(t));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('hotels_not_configured');
  });

  it('validates search input', async () => {
    const app = appWith(fakeProvider('sandbox'));
    const t = await signIn(app, 'hotels-search@example.test');
    const base = { city: 'Paris', country_code: 'FR', checkin: inDays(10), checkout: inDays(12), rooms: [{ adults: 2 }] };
    expect((await request(app).post('/api/v1/hotels/search').set(as(t)).send(base)).status).toBe(200);
    for (const bad of [
      { ...base, city: undefined },                                   // no location
      { ...base, checkin: inDays(-1) },                               // past
      { ...base, checkout: base.checkin },                            // zero nights
      { ...base, checkout: inDays(60) },                              // > 30 nights
      { ...base, rooms: [{ adults: 0 }] },                            // no adult
      { ...base, rooms: [{ adults: 2, children: [18] }] },            // not a child
      { ...base, extra: true },                                       // unknown field
    ]) {
      expect((await request(app).post('/api/v1/hotels/search').set(as(t)).send(bad)).status).toBe(400);
    }
  });

  it('books, records the booking for its owner only, and cancels', async () => {
    const app = appWith(fakeProvider('sandbox'));
    const ann = await signIn(app, 'hotels-ann@example.test');
    const ben = await signIn(app, 'hotels-ben@example.test');
    const res = await request(app).post('/api/v1/hotels/book').set(as(ann)).send(bookBody());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ recorded: true, booking: { booking_id: 'bk-pb-offer-1', sandbox: true, country_code: 'FR' } });

    const mine = await request(app).get('/api/v1/hotels/bookings').set(as(ann));
    expect(mine.body.bookings.map((b: any) => b.booking_id)).toEqual(['bk-pb-offer-1']);
    expect((await request(app).get('/api/v1/hotels/bookings').set(as(ben))).body.bookings).toEqual([]);
    expect((await request(app).get('/api/v1/hotels/bookings/bk-pb-offer-1').set(as(ben))).status).toBe(404);
    expect((await request(app).post('/api/v1/hotels/bookings/bk-pb-offer-1/cancel').set(as(ben))).status).toBe(404);

    const detail = await request(app).get('/api/v1/hotels/bookings/bk-pb-offer-1').set(as(ann));
    expect(detail.body.booking).toMatchObject({ hotel_name: 'Hotel Lumière', provider: { hotelId: 'lp1897' } });

    const cancel = await request(app).post('/api/v1/hotels/bookings/bk-pb-offer-1/cancel').set(as(ann));
    expect(cancel.body.cancellation).toMatchObject({ status: 'CANCELLED', refundAmount: 240 });
    expect((await request(app).post('/api/v1/hotels/bookings/bk-pb-offer-1/cancel').set(as(ann))).status).toBe(409);
    const { rows } = await db.query(`select status, refund_amount from public.hotel_bookings where provider_booking_id = 'bk-pb-offer-1'`);
    expect(rows[0]).toMatchObject({ status: 'CANCELLED', refund_amount: '240.00' });
  });

  it('rejects invalid booking details', async () => {
    const app = appWith(fakeProvider('sandbox'));
    const t = await signIn(app, 'hotels-invalid@example.test');
    const b = bookBody('pb-x');
    for (const bad of [
      { ...b, holder: { ...b.holder, email: 'not-an-email' } },
      { ...b, holder: { ...b.holder, phone: 'abc' } },
      { ...b, guests: [] },
      { ...b, checkout: b.checkin },
    ]) {
      expect((await request(app).post('/api/v1/hotels/book').set(as(t)).send(bad)).status).toBe(400);
    }
  });

  it('never makes live bookings unless explicitly allowed', async () => {
    calls.length = 0;
    const live = appWith(fakeProvider('production'));
    const t = await signIn(live, 'hotels-live@example.test');
    const res = await request(live).post('/api/v1/hotels/book').set(as(t)).send(bookBody('pb-live'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('live_booking_disabled');
    expect(calls).toEqual([]);

    // A live account behind sandbox configuration is caught at prebook
    prebookSandbox = false;
    const mixed = appWith(fakeProvider('sandbox'));
    const pre = await request(mixed).post('/api/v1/hotels/prebook').set(as(t)).send({ offer_id: 'o1' });
    expect(pre.status).toBe(403);
    expect(calls).toEqual(['prebook:o1']);           // this check needs the provider's answer, so prebook does run
    prebookSandbox = true;
    calls.length = 0;

    // A production key in a sandbox configuration never reaches the provider, even if the client skips prebook
    // and even with LITEAPI_ALLOW_LIVE_BOOKINGS=true (live bookings also need LITEAPI_ENV=production)
    for (const allow of [false, true]) {
      const prodKey = appWith(fakeProvider('sandbox', false), allow);
      const bk = await request(prodKey).post('/api/v1/hotels/book').set(as(t)).send(bookBody('pb-prodkey'));
      expect(bk.status).toBe(403);
      expect(bk.body.error.code).toBe('live_booking_disabled');
      expect((await request(prodKey).post('/api/v1/hotels/prebook').set(as(t)).send({ offer_id: 'o2' })).status).toBe(403);
    }
    expect(calls).toEqual([]);

    const allowed = appWith(fakeProvider('production'), true);
    expect((await request(allowed).post('/api/v1/hotels/book').set(as(t)).send(bookBody('pb-live-ok'))).status).toBe(201);
  });
});
