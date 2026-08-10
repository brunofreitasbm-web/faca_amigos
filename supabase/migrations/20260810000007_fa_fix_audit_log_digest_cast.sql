-- Fix `digest(text, unknown)` error on `fa_kiosk_audit_log` trigger
-- Explicitly cast string concatenation to `bytea` and set search_path so `digest` from `pgcrypto` is resolved correctly.

create extension if not exists pgcrypto;

create or replace function fa_kiosk_audit_log_hash_chain() returns trigger as $$
declare
  last_hash text;
begin
  select self_hash into last_hash from fa_kiosk_audit_log order by at_ms desc, id desc limit 1;
  new.prev_hash := last_hash;
  new.self_hash := encode(
    digest((coalesce(last_hash, '') || new.id::text || new.at_ms::text || new.action || coalesce(new.details_json::text, ''))::bytea, 'sha256'),
    'hex'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, extensions, pg_temp;

revoke execute on function fa_kiosk_audit_log_hash_chain() from public, anon, authenticated;
