-- One payment of Bs 150 opens every course for life.
-- "Lifetime" is stored as 100 years, so fulfill_order and has_access keep
-- working unchanged. The time-based plans stay for the orders that reference
-- them, but are no longer offered.
alter table public.plans drop constraint plans_days_check;
alter table public.plans add constraint plans_days_check check (days >= 1 and days <= 36500);

insert into public.plans (id, name, price_bob, days, active, sort)
values ('lifetime', 'Lifetime access', 150, 36500, true, 0)
on conflict (id) do update
  set name = excluded.name, price_bob = excluded.price_bob, days = excluded.days,
      active = true, sort = excluded.sort;

update public.plans set active = false where id in ('month', 'semester', 'year');
