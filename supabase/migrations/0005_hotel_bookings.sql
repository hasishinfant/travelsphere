-- Hotel bookings made through the hotel inventory provider (LiteAPI). The provider is the system of record for the
-- reservation; this table records who booked what so travellers can list and manage their own bookings.

create table if not exists public.hotel_bookings (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  provider            text not null default 'liteapi' check (provider in ('liteapi')),
  provider_booking_id text not null check (char_length(provider_booking_id) between 1 and 100),
  client_reference    text not null unique check (char_length(client_reference) between 8 and 100),
  hotel_id            text not null check (char_length(hotel_id) between 1 and 100),
  hotel_name          text not null check (char_length(hotel_name) between 1 and 300),
  city                text check (char_length(city) <= 120),
  country_code        char(2) check (country_code ~ '^[A-Z]{2}$'),
  checkin             date not null,
  checkout            date not null,
  rooms               smallint not null check (rooms between 1 and 9),
  guests              smallint not null check (guests between 1 and 40),
  room_name           text check (char_length(room_name) <= 300),
  board_name          text check (char_length(board_name) <= 120),
  price               numeric(12, 2) not null check (price >= 0),
  currency            char(3) not null check (currency ~ '^[A-Z]{3}$'),
  refundable          boolean,
  status              text not null check (status in ('CONFIRMED', 'CANCELLED', 'CANCELLED_WITH_CHARGES')),
  cancellation_fee    numeric(12, 2) check (cancellation_fee >= 0),
  refund_amount       numeric(12, 2) check (refund_amount >= 0),
  sandbox             boolean not null,
  holder_name         text not null check (char_length(holder_name) between 1 and 200),
  holder_email        text not null check (char_length(holder_email) between 3 and 254),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint hotel_bookings_dates check (checkout > checkin),
  unique (provider, provider_booking_id)
);
create index if not exists hotel_bookings_user_idx on public.hotel_bookings (user_id, checkin desc);
create trigger hotel_bookings_updated_at before update on public.hotel_bookings
  for each row execute function public.set_updated_at();

-- Travellers read their own bookings; staff can read all. Writes happen only on the server after the provider
-- confirms (no insert/update policy for travellers).
alter table public.hotel_bookings enable row level security;
create policy hotel_bookings_read on public.hotel_bookings for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
