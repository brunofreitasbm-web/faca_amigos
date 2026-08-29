-- 2026-08-30: get_advisors(security) flags again that public.colaboradores,
-- public.pins, public.fluxo_caixa_referencia_loja and public.configuracoes
-- have RLS fully disabled. These 4 belong to a separate (non-FaçaAmigos)
-- system that shares this Supabase project (see 20260825000001) and were
-- already covered by that migration -- but RLS on exactly these 4 got
-- turned back off afterwards by something outside this repo (no migration
-- here disables it again). Confirmed live: `authenticated` still has full
-- SELECT/INSERT/UPDATE/DELETE on all 4 and `anon` has none, so any logged-in
-- FaçaAmigos kiosk employee JWT can read/write another product's `pins`
-- (login PINs) and `configuracoes` directly via PostgREST. Owner confirmed
-- (2026-08-29) this other system is also theirs and is safe to relock.
--
-- Re-enabling RLS with no policies default-denies anon/authenticated access
-- (same as 20260825000001) while leaving service_role (BYPASSRLS) and any
-- backend using the service key unaffected.
alter table public.colaboradores enable row level security;
alter table public.pins enable row level security;
alter table public.fluxo_caixa_referencia_loja enable row level security;
alter table public.configuracoes enable row level security;
