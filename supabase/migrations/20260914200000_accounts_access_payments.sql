-- =====================================================================
-- Brain Academy: accounts, paid access and QR payments
--
-- The browser only ever uses the publishable key, so every table here is
-- protected by Row Level Security. Money-related writes (orders, access)
-- happen only in Edge Functions with the secret key, never from a client.
-- =====================================================================

-- ---------------------------------------------------------------------
-- shared: updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles: one row per account, created by a trigger on sign-up
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (full_name is null or char_length(full_name) <= 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner can read"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: owner can update"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- a student may change their name, nothing else
revoke update on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '')
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- plans: what a QR payment buys. Prices are in bolivianos.
-- ---------------------------------------------------------------------
create table public.plans (
  id         text primary key check (id ~ '^[a-z0-9_-]{2,32}$'),
  name       text not null,
  price_bob  numeric(10, 2) not null check (price_bob > 0),
  days       integer not null check (days between 1 and 1100),
  active     boolean not null default true,
  sort       integer not null default 0
);

alter table public.plans enable row level security;

create policy "plans: anyone can read active plans"
  on public.plans for select to anon, authenticated
  using (active);

-- placeholder prices; change them in the table, no deploy needed
insert into public.plans (id, name, price_bob, days, sort) values
  ('month',    '1 month',   49.00,  30, 1),
  ('semester', '6 months', 199.00, 182, 2),
  ('year',     '12 months', 349.00, 365, 3);

-- ---------------------------------------------------------------------
-- entitlements: paid access, one row per account
-- ---------------------------------------------------------------------
create table public.entitlements (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  access_until  timestamptz not null,
  updated_at    timestamptz not null default now()
);

alter table public.entitlements enable row level security;

create policy "entitlements: owner can read"
  on public.entitlements for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.has_access()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.entitlements e
    where e.user_id = (select auth.uid())
      and e.access_until > now()
  );
$$;

-- ---------------------------------------------------------------------
-- orders: one QR charge. Amount and days are copied from the plan so a
-- later price change never alters an order that was already shown.
-- ---------------------------------------------------------------------
create type public.order_status as enum ('pending', 'paid', 'expired', 'cancelled');

create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  plan_id       text not null references public.plans (id),
  amount_bob    numeric(10, 2) not null check (amount_bob > 0),
  days          integer not null check (days > 0),
  status        public.order_status not null default 'pending',
  provider      text not null,
  provider_ref  text,
  qr_text       text,
  qr_image      text,
  expires_at    timestamptz not null,
  paid_at       timestamptz,
  created_at    timestamptz not null default now()
);

create unique index orders_provider_ref_key on public.orders (provider, provider_ref) where provider_ref is not null;
create index orders_user_created_idx on public.orders (user_id, created_at desc);
create index orders_plan_id_idx on public.orders (plan_id);

alter table public.orders enable row level security;

create policy "orders: owner can read"
  on public.orders for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- fulfil an order: mark it paid and extend access, exactly once.
-- Only Edge Functions call this, after confirming with the provider.
-- ---------------------------------------------------------------------
create or replace function public.fulfill_order(p_order_id uuid)
returns public.orders
language plpgsql
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  -- a webhook and a status check can both arrive; the second is a no-op
  if o.status = 'paid' then
    return o;
  end if;

  -- a late payment on an expired QR still counts: the money arrived
  if o.status = 'cancelled' then
    raise exception 'order % was cancelled and cannot be fulfilled', p_order_id;
  end if;

  update public.orders
     set status = 'paid', paid_at = now()
   where id = p_order_id
  returning * into o;

  insert into public.entitlements (user_id, access_until, updated_at)
  values (o.user_id, now() + make_interval(days => o.days), now())
  on conflict (user_id) do update
    set access_until = greatest(public.entitlements.access_until, now()) + make_interval(days => o.days),
        updated_at = now();

  return o;
end;
$$;

revoke execute on function public.fulfill_order(uuid) from public, anon, authenticated;
grant execute on function public.fulfill_order(uuid) to service_role;

-- ---------------------------------------------------------------------
-- payment_events: audit trail of webhooks and fulfilments
-- ---------------------------------------------------------------------
create table public.payment_events (
  id            bigint generated always as identity primary key,
  provider      text not null,
  provider_ref  text,
  order_id      uuid references public.orders (id) on delete set null,
  kind          text not null,
  payload       jsonb not null default '{}'::jsonb,
  received_at   timestamptz not null default now()
);

create index payment_events_order_idx on public.payment_events (order_id);

alter table public.payment_events enable row level security;
-- no policies: only the secret key used by Edge Functions can touch it

-- ---------------------------------------------------------------------
-- test provider: stands in for a real QR provider until one is signed
-- ---------------------------------------------------------------------
create table public.mock_charges (
  provider_ref  text primary key,
  order_id      uuid not null references public.orders (id) on delete cascade,
  amount_bob    numeric(10, 2) not null,
  status        text not null default 'pending' check (status in ('pending', 'paid')),
  created_at    timestamptz not null default now()
);

create index mock_charges_order_idx on public.mock_charges (order_id);

alter table public.mock_charges enable row level security;
-- no policies

-- ---------------------------------------------------------------------
-- admins and settings: server-side only
-- ---------------------------------------------------------------------
-- keyed by account id, not email: an email can be registered by anyone
-- before its owner signs up, an id cannot be claimed that way
create table public.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.admins enable row level security;

create table public.app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- 'test' lets admins simulate payments; set to 'live' once a real
-- provider is configured, which also disables the test provider
insert into public.app_settings (key, value) values ('payment_mode', 'test');

-- ---------------------------------------------------------------------
-- course_content: the paid courses, readable only with active access
-- ---------------------------------------------------------------------
create table public.course_content (
  route       text primary key check (route ~ '^[a-z0-9-]{2,40}$'),
  html        text not null,
  es          jsonb not null default '{}'::jsonb check (jsonb_typeof(es) = 'object'),
  updated_at  timestamptz not null default now()
);

alter table public.course_content enable row level security;

create policy "course_content: readable with active access"
  on public.course_content for select to authenticated
  using ((select public.has_access()));

create trigger course_content_set_updated_at
  before update on public.course_content
  for each row execute function public.set_updated_at();
