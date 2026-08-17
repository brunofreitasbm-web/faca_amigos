-- Link Geral de auto-cadastro de estagiário: diferente do convite
-- individual (fa_kiosk_onboarding_invites — um token de uso único por
-- pessoa, com papel/cargo decididos pelo Owner), este é UM token fixo por
-- unidade, reutilizável por qualquer pessoa que o receba, sempre criando o
-- colaborador como ESTAGIARIO (nunca um papel maior — decisão de produto,
-- não é ajustável por quem preenche o formulário). Pensado para ser
-- divulgado livremente (grupo de WhatsApp da equipe, cartaz, etc.), por
-- isso não expira e não é de uso único.
--
-- O token fica em texto puro (ao contrário do convite individual, que só
-- guarda o hash) porque o Owner precisa poder reabrir a tela de
-- Colaboradores e ver/copiar o mesmo link de novo — não há fluxo de
-- "esqueci o link" aqui, e o token não é mais sensível do que a própria
-- URL, que já é feita para ser compartilhada.
create table if not exists fa_kiosk_unit_general_invites (
  unit_id uuid primary key references fa_kiosk_units (id) on delete cascade,
  token text not null unique,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- RLS habilitada, sem NENHUMA policy — mesmo espírito de
-- fa_kiosk_onboarding_invites: só as Edge Functions (service role) tocam
-- esta tabela. general-invite-link exige config.employees.write antes de
-- gerar/ler o token; general-invite-info e general-onboarding-complete são
-- anon-callable mas só aceitam quem já tem o token em mãos.
alter table fa_kiosk_unit_general_invites enable row level security;
