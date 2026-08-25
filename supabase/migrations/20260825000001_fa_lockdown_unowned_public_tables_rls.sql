-- 2026-08-25: get_advisors(security) flagged 19 public.* tables with RLS fully disabled.
-- 17 of these (all except fa_kiosk_legacy_imports) are not referenced anywhere in this repo
-- (apps/kiosk, apps/kiosk-ui, supabase/functions) -- they belong to a separate multi-tenant
-- system (organizations/tenant_negocios/colaboradores/pins/sessions/catalogo_*/ifood_*) that
-- shares this Supabase project. anon already has zero grants on all of them; authenticated has
-- full grants on all of them, meaning any authenticated JWT (including any FaçaAmigos employee)
-- could read/write another product's PINs, session tokens, and iFood sync data directly via
-- PostgREST. Enabling RLS with no policies default-denies anon/authenticated access while
-- leaving service_role (BYPASSRLS) and any backend using the service key unaffected.
alter table public.catalogo_produtos enable row level security;
alter table public.fa_kiosk_legacy_imports enable row level security;
alter table public.catalogo_lojas enable row level security;
alter table public.catalogo_loja_produtos enable row level security;
alter table public.catalogo_pedidos enable row level security;
alter table public.ifood_config enable row level security;
alter table public.pins enable row level security;
alter table public.colaboradores enable row level security;
alter table public.fluxo_caixa_referencia_loja enable row level security;
alter table public.configuracoes enable row level security;
alter table public.ifood_sync_history enable row level security;
alter table public.ia_uso enable row level security;
alter table public.planos_precificacao enable row level security;
alter table public.nfe_conferencia enable row level security;
alter table public.tenant_negocios enable row level security;
alter table public.organizations enable row level security;
alter table public.unidades enable row level security;
alter table public.tenant_modules enable row level security;
alter table public.sessions enable row level security;
