import { z } from 'zod';

export const DEST_ID = z.string().regex(/^[a-z0-9-]{2,40}$/, 'Invalid destination id');
export const UUID = z.string().uuid();

export const Page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const pageMeta = (limit: number, offset: number, returned: number) =>
  ({ limit, offset, returned, next_offset: returned === limit ? offset + limit : null });

export const Coordinate = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict().refine(c => !(c.latitude === 0 && c.longitude === 0), '(0, 0) is not accepted as a location');

/** Wall-clock time at a destination → UTC ISO string, using the IANA zone (no external tz library). */
export function zonedIso(date: string, hhmm: string, timeZone: string | null): string {
  const naive = new Date(`${date}T${hhmm}:00Z`);
  if (!timeZone) return naive.toISOString();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(naive).map(p => [p.type, p.value]));
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(naive.getTime() - (asIfUtc - naive.getTime())).toISOString();
}
