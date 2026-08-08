-- Link de convite individual: RH gera um link por pessoa (função, unidade e
-- data de admissão já decididas por quem convida), a pessoa abre sem
-- nenhuma conta prévia, preenche os próprios dados e escolhe o PIN — e o
-- colaborador é criado nesse momento. Único ponto de entrada além do login
-- por PIN que não exige sessão prévia (ver comentário de login-pin), então
-- segue o mesmo cuidado: token de alta entropia, só o hash é guardado, e
-- toda escrita real acontece nas Edge Functions com a service role — esta
-- tabela não tem NENHUMA policy de RLS de propósito.

create table if not exists fa_kiosk_onboarding_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  role text not null check (role in ('OPERADOR', 'GERENTE', 'ADMIN')),
  position text not null,
  unit_ids uuid[] not null default '{}',
  full_name_hint text,
  admission_date date,
  created_by_employee_id uuid references fa_kiosk_employees (id),
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  expires_at_ms bigint not null,
  failed_attempts int not null default 0,
  used_at_ms bigint,
  used_by_employee_id uuid references fa_kiosk_employees (id)
);

-- RLS habilitada, mas de propósito sem NENHUMA policy — nem para
-- `authenticated`, nem para `anon`. As três Edge Functions (create-
-- onboarding-invite, onboarding-invite-info, onboarding-complete) usam a
-- service role, que ignora RLS; ninguém mais consegue ler ou escrever aqui,
-- nem o Owner via RPC direta.
alter table fa_kiosk_onboarding_invites enable row level security;
