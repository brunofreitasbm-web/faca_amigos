-- Complemento da migration 20260807000014: o colaborador precisa conseguir
-- ver a própria chave Pix já salva ao reabrir o Cadastro de Colaboradores,
-- mas fa_kiosk_employee_payroll_info só é legível por quem tem
-- folha_pagamento.read (Owner) — expor salário/conta bancária pra qualquer
-- Operador logado é exatamente o que essa tabela foi criada pra evitar.
-- Função estreita: devolve só o pix_key da própria linha, nada mais.
create or replace function fa_kiosk_my_pix()
returns text as $$
  select pix_key from fa_kiosk_employee_payroll_info
   where employee_id = fa_kiosk_current_employee_id();
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_my_pix() from public, anon;
grant execute on function fa_kiosk_my_pix() to authenticated;
