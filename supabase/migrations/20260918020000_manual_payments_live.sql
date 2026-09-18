-- ---------------------------------------------------------------------
-- settings: which provider new orders use. Payments go live with the
-- manual provider; it refuses to create orders until a QR is uploaded.
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values ('payment_provider', 'manual')
on conflict (key) do update set value = excluded.value, updated_at = now();

update public.app_settings set value = 'live', updated_at = now() where key = 'payment_mode';
