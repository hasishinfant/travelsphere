// LiteAPI (Nuitée) hotel inventory: search, details, prebook, book, retrieve and cancel.
// Docs: https://docs.nuitee.com. The API key is server-side only (X-API-Key header).
// Responses are normalised here so the rest of the app never depends on the provider's field names.
import { HttpError } from '../http.js';

const SEARCH_HOST = 'https://api.liteapi.travel/v3.0';
const BOOK_HOST = 'https://book.liteapi.travel/v3.0';

type FetchFn = typeof fetch;

export interface Occupancy { adults: number; children: number[] }

export interface HotelSearchInput {
  checkin: string;            // YYYY-MM-DD
  checkout: string;
  occupancies: Occupancy[];   // one per room
  currency: string;           // ISO 4217
  guestNationality: string;   // ISO 3166-1 alpha-2
  cityName?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  radiusM?: number;
  limit?: number;
}

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
  offers: HotelOffer[];         // cheapest first
}

export interface HotelDetails {
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

export interface PrebookResult {
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
  sandbox: boolean | null;
}

export interface BookInput {
  prebookId: string;
  clientReference: string;
  holder: { firstName: string; lastName: string; email: string; phone: string };
  guests: { occupancyNumber: number; firstName: string; lastName: string; email: string }[];
}

export interface BookingResult {
  bookingId: string;
  status: string;
  price: number;
  currency: string;
  checkin: string;
  checkout: string;
  hotelName: string | null;
  sandbox: boolean | null;
}

export interface BookingDetails extends BookingResult {
  hotelId: string | null;
  hotelConfirmationCode: string | null;
  rooms: { roomName: string; boardName: string; adults: number; children: number; guestName: string }[];
  holder: { firstName: string; lastName: string; email: string } | null;
  cancellation: string;
  createdAt: string | null;
}

export interface CancelResult {
  bookingId: string;
  status: string;
  cancellationFee: number;
  refundAmount: number;
  currency: string;
}

export interface HotelProvider {
  readonly env: 'sandbox' | 'production';
  /** Whether the API key itself is a sandbox key (LiteAPI prefixes them `sand_`); anything else can bill the account. */
  readonly sandboxKey: boolean;
  search(input: HotelSearchInput): Promise<{ hotels: HotelSearchHit[]; sandbox: boolean | null }>;
  details(hotelId: string): Promise<HotelDetails>;
  prebook(offerId: string): Promise<PrebookResult>;
  book(input: BookInput): Promise<BookingResult>;
  getBooking(bookingId: string): Promise<BookingDetails>;
  cancel(bookingId: string): Promise<CancelResult>;
}

// ------------------------------------------------------------------ normalisation helpers
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** retailRate.total is an array in search/prebook responses and an object in booking responses. */
export function amountOf(v: unknown): { amount: number; currency: string } | null {
  const x = Array.isArray(v) ? v[0] : v;
  const amount = num((x as { amount?: unknown })?.amount);
  const currency = str((x as { currency?: unknown })?.currency);
  return amount !== null && currency ? { amount, currency } : null;
}

const stripHtml = (html: string) => html
  .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/** Human-readable cancellation terms from a rate's cancellationPolicies. */
export function describeCancellation(policies: any): { refundable: boolean; text: string } {
  const refundable = policies?.refundableTag === 'RFN';
  if (!refundable) return { refundable: false, text: 'Non-refundable' };
  const times = (Array.isArray(policies?.cancelPolicyInfos) ? policies.cancelPolicyInfos : [])
    .map((p: any) => str(p?.cancelTime)).filter(Boolean) as string[];
  const first = times.sort()[0];
  return { refundable: true, text: first ? `Free cancellation until ${first.replace('T', ' ').slice(0, 16)}` : 'Free cancellation' };
}

function offerFrom(roomType: any): HotelOffer | null {
  const rates: any[] = Array.isArray(roomType?.rates) ? roomType.rates : [];
  const offerId = str(roomType?.offerId);
  if (!offerId || !rates.length) return null;
  // offerRetailRate is the total for all rooms; otherwise add up the per-room rates
  let total = amountOf(roomType?.offerRetailRate);
  if (!total) {
    const parts = rates.map(r => amountOf(r?.retailRate?.total));
    if (parts.some(p => !p)) return null;
    total = { amount: parts.reduce((s, p) => s + p!.amount, 0), currency: parts[0]!.currency };
  }
  const allRefundable = rates.every(r => r?.cancellationPolicies?.refundableTag === 'RFN');
  const cancellation = allRefundable ? describeCancellation(rates[0]?.cancellationPolicies)
    : { refundable: false, text: 'Non-refundable' };
  return {
    offerId,
    roomName: str(rates[0]?.name) ?? str(roomType?.name) ?? 'Room',
    boardName: str(rates[0]?.boardName) ?? 'Room only',
    refundable: cancellation.refundable,
    cancellation: cancellation.text,
    price: Math.round(total.amount * 100) / 100,
    currency: total.currency,
  };
}

// ------------------------------------------------------------------ client
export function createLiteApi(opts: { apiKey: string; env: 'sandbox' | 'production'; timeoutMs: number },
  fetchFn: FetchFn = fetch): HotelProvider {

  async function call(method: string, url: string, body?: unknown): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetchFn(url, {
        method,
        headers: { 'X-API-Key': opts.apiKey, Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      const timedOut = (err as Error)?.name === 'AbortError';
      throw new HttpError(timedOut ? 504 : 502, 'hotel_provider_unavailable',
        timedOut ? 'The hotel provider did not respond in time' : 'The hotel provider is unreachable');
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    if (res.ok) return data;

    const providerMessage = str(data?.error?.message) ?? str(data?.message) ?? undefined;
    const details = providerMessage ? { provider_message: providerMessage } : undefined;
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(503, 'hotels_not_configured', 'The hotel provider rejected the API key');
    }
    if (res.status === 404) throw new HttpError(404, 'not_found', 'Not found at the hotel provider', details);
    if (res.status === 409) {
      throw new HttpError(409, 'booking_in_progress', 'A booking for this offer is already being processed', details);
    }
    if (res.status === 410) {
      throw new HttpError(410, 'offer_expired', 'This room is no longer available at this price — search again', details);
    }
    if (res.status === 408) throw new HttpError(504, 'hotel_provider_timeout', 'The hotel provider timed out', details);
    if (res.status === 429) throw new HttpError(429, 'hotel_provider_rate_limited', 'Too many hotel requests — try again shortly');
    if (res.status >= 400 && res.status < 500) {
      throw new HttpError(400, 'hotel_request_rejected', providerMessage ?? 'The hotel provider rejected the request', details);
    }
    throw new HttpError(502, 'hotel_provider_error', 'The hotel provider failed');
  }

  return {
    env: opts.env,
    sandboxKey: opts.apiKey.startsWith('sand_'),

    async search(input) {
      const location = input.cityName && input.countryCode
        ? { cityName: input.cityName, countryCode: input.countryCode }
        : { latitude: input.latitude, longitude: input.longitude, radius: input.radiusM ?? 10_000 };
      const rates = await call('POST', `${SEARCH_HOST}/hotels/rates`, {
        ...location,
        checkin: input.checkin, checkout: input.checkout, currency: input.currency,
        guestNationality: input.guestNationality,
        occupancies: input.occupancies.map(o => ({ adults: o.adults, children: o.children })),
        maxRatesPerHotel: 3, limit: input.limit ?? 30, timeout: 8,
      });
      const withOffers = (Array.isArray(rates?.data) ? rates.data : [])
        .map((h: any) => ({ hotelId: str(h?.hotelId), offers: (h?.roomTypes ?? []).map(offerFrom).filter(Boolean) as HotelOffer[] }))
        .filter((h: { hotelId: string | null; offers: HotelOffer[] }) => h.hotelId && h.offers.length);
      if (!withOffers.length) return { hotels: [], sandbox: rates?.sandbox ?? null };

      // Static content (name, address, photo, stars) for the hotels that have rates
      const ids = withOffers.map((h: { hotelId: string }) => h.hotelId);
      const stat = await call('GET', `${SEARCH_HOST}/data/hotels?${new URLSearchParams({ hotelIds: ids.join(','), limit: String(ids.length) })}`);
      const byId = new Map<string, any>((Array.isArray(stat?.data) ? stat.data : []).map((h: any) => [String(h?.id), h]));

      const hotels: HotelSearchHit[] = withOffers.map((h: { hotelId: string; offers: HotelOffer[] }) => {
        const s = byId.get(h.hotelId) ?? {};
        return {
          hotelId: h.hotelId,
          name: str(s.name) ?? 'Hotel',
          address: str(s.address) ?? '',
          city: str(s.city) ?? input.cityName ?? '',
          countryCode: (str(s.country) ?? input.countryCode ?? '').toUpperCase(),
          starRating: num(s.stars) ?? 0,
          guestRating: num(s.rating),
          photo: str(s.main_photo) ?? str(s.thumbnail),
          latitude: num(s.latitude),
          longitude: num(s.longitude),
          offers: h.offers.sort((a, b) => a.price - b.price),
        };
      }).sort((a: HotelSearchHit, b: HotelSearchHit) => a.offers[0].price - b.offers[0].price);
      return { hotels, sandbox: typeof rates?.sandbox === 'boolean' ? rates.sandbox : null };
    },

    async details(hotelId) {
      const res = await call('GET', `${SEARCH_HOST}/data/hotel?${new URLSearchParams({ hotelId })}`);
      const d = res?.data ?? {};
      const images = (Array.isArray(d.hotelImages) ? d.hotelImages : [])
        .sort((a: any, b: any) => (b?.defaultImage ? 1 : 0) - (a?.defaultImage ? 1 : 0))
        .map((i: any) => str(i?.urlHd) ?? str(i?.url)).filter(Boolean) as string[];
      const facilities: string[] = Array.isArray(d.hotelFacilities) && d.hotelFacilities.length
        ? d.hotelFacilities.filter((f: unknown) => typeof f === 'string')
        : (Array.isArray(d.facilities) ? d.facilities.map((f: any) => str(f?.name)).filter(Boolean) : []);
      const times = d.checkinCheckoutTimes ?? {};
      return {
        hotelId: str(d.id) ?? hotelId,
        name: str(d.name) ?? 'Hotel',
        description: str(d.hotelDescription) ? stripHtml(d.hotelDescription) : '',
        address: str(d.address) ?? '',
        city: str(d.city) ?? '',
        countryCode: (str(d.country) ?? '').toUpperCase(),
        starRating: num(d.starRating) ?? num(d.stars) ?? 0,
        images: images.length ? images : [str(d.main_photo)].filter(Boolean) as string[],
        facilities: facilities.slice(0, 40),
        latitude: num(d.location?.latitude) ?? num(d.latitude),
        longitude: num(d.location?.longitude) ?? num(d.longitude),
        checkinTime: str(times.checkin_start) ?? str(d.policyAttributes?.checkIn?.from),
        checkoutTime: str(times.checkout) ?? str(d.policyAttributes?.checkOut?.until),
        importantInformation: str(d.hotelImportantInformation) ? stripHtml(d.hotelImportantInformation) : null,
      };
    },

    async prebook(offerId) {
      const res = await call('POST', `${BOOK_HOST}/rates/prebook?timeout=30`, { offerId, usePaymentSdk: false });
      const d = res?.data ?? {};
      const rates: any[] = (d.roomTypes ?? []).flatMap((rt: any) => rt?.rates ?? []);
      const allRefundable = rates.length > 0 && rates.every(r => r?.cancellationPolicies?.refundableTag === 'RFN');
      const cancellation = allRefundable ? describeCancellation(rates[0]?.cancellationPolicies)
        : { refundable: false, text: 'Non-refundable' };
      const price = num(d.price);
      if (!str(d.prebookId) || price === null) {
        throw new HttpError(502, 'hotel_provider_error', 'The hotel provider returned an incomplete prebook');
      }
      return {
        prebookId: d.prebookId, offerId: str(d.offerId) ?? offerId, hotelId: str(d.hotelId) ?? '',
        price, currency: str(d.currency) ?? '',
        priceDifferencePercent: num(d.priceDifferencePercent) ?? 0,
        cancellationChanged: d.cancellationChanged === true,
        boardChanged: d.boardChanged === true,
        refundable: cancellation.refundable, cancellation: cancellation.text,
        sandbox: typeof res?.sandbox === 'boolean' ? res.sandbox : null,
      };
    },

    async book(input) {
      const res = await call('POST', `${BOOK_HOST}/rates/book?timeout=60`, {
        prebookId: input.prebookId,
        clientReference: input.clientReference,
        holder: input.holder,
        guests: input.guests,
        // Account payment: simulated (no charge) in sandbox; billed to the LiteAPI account in production
        payment: { method: 'ACC_CREDIT_CARD' },
      });
      const d = res?.data ?? {};
      const price = num(d.price);
      if (!str(d.bookingId) || price === null) {
        throw new HttpError(502, 'hotel_provider_error', 'The hotel provider returned an incomplete booking');
      }
      return {
        bookingId: d.bookingId, status: str(d.status) ?? 'CONFIRMED', price, currency: str(d.currency) ?? '',
        checkin: str(d.checkin) ?? '', checkout: str(d.checkout) ?? '',
        hotelName: str(d.hotel?.name),
        sandbox: typeof res?.sandbox === 'boolean' ? res.sandbox : typeof d.sandbox === 'boolean' ? d.sandbox : null,
      };
    },

    async getBooking(bookingId) {
      const res = await call('GET', `${BOOK_HOST}/bookings/${encodeURIComponent(bookingId)}`);
      const d = res?.data ?? {};
      const rooms = (Array.isArray(d.bookedRooms) ? d.bookedRooms : []).map((r: any) => ({
        roomName: str(r?.roomType?.name) ?? 'Room',
        boardName: str(r?.boardName) ?? 'Room only',
        adults: num(r?.adults) ?? 0,
        children: num(r?.children) ?? (Array.isArray(r?.childrenAges) ? r.childrenAges.length : 0),
        guestName: [str(r?.firstName), str(r?.lastName)].filter(Boolean).join(' '),
      }));
      const firstRate = (d.bookedRooms ?? [])[0]?.rate;
      return {
        bookingId: str(d.bookingId) ?? bookingId,
        status: str(d.status) ?? 'UNKNOWN',
        price: num(d.price) ?? amountOf(firstRate?.retailRate?.total)?.amount ?? 0,
        currency: str(d.currency) ?? '',
        checkin: str(d.checkin) ?? '', checkout: str(d.checkout) ?? '',
        hotelName: str(d.hotel?.name),
        hotelId: str(d.hotel?.hotelId),
        hotelConfirmationCode: str(d.hotelConfirmationCode),
        rooms,
        holder: d.holder ? { firstName: str(d.holder.firstName) ?? '', lastName: str(d.holder.lastName) ?? '',
          email: str(d.holder.email) ?? '' } : null,
        cancellation: describeCancellation(d.cancellationPolicies ?? firstRate?.cancellationPolicies).text,
        createdAt: str(d.createdAt),
        sandbox: typeof d.sandbox === 'boolean' ? d.sandbox : null,
      };
    },

    async cancel(bookingId) {
      const res = await call('PUT', `${BOOK_HOST}/bookings/${encodeURIComponent(bookingId)}`);
      const d = res?.data ?? {};
      return {
        bookingId: str(d.bookingId) ?? bookingId,
        status: str(d.status) ?? 'CANCELLED',
        cancellationFee: num(d.cancellation_fee) ?? 0,
        refundAmount: num(d.refund_amount) ?? 0,
        currency: str(d.currency) ?? '',
      };
    },
  };
}
