-- OAuth 2.1 (PKCE, clientes públicos) para o MCP: exigido por claude.ai web/celular
-- e por clientes que não aceitam chave fixa. Uma única pessoa (o dono) autoriza,
-- com uma senha cujo hash (scrypt) fica em fa_mcp_oauth_config.
--
-- Tudo aqui é lido/escrito só pela service_role (função serverless da Vercel):
-- RLS ligada, sem policy, e sem privilégio para anon/authenticated.
-- Códigos e tokens ficam gravados apenas como hash SHA-256.

create table if not exists fa_mcp_oauth_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table if not exists fa_mcp_oauth_codes (
  code_hash text primary key,
  client_id text not null references fa_mcp_oauth_clients (client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null
);

create table if not exists fa_mcp_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references fa_mcp_oauth_clients (client_id) on delete cascade,
  access_hash text not null unique,
  refresh_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Linha única (id = 1): senha do dono e trava contra tentativa em massa.
create table if not exists fa_mcp_oauth_config (
  id smallint primary key default 1 check (id = 1),
  password_hash text not null,
  failed_count integer not null default 0,
  locked_until timestamptz
);

do $$
declare t text;
begin
  foreach t in array array['fa_mcp_oauth_clients','fa_mcp_oauth_codes','fa_mcp_oauth_tokens','fa_mcp_oauth_config']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;
