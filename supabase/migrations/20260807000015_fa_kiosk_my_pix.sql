-- Complemento da migration 20260807000014: o colaborador precisa conseguir
-- ver a própria chave Pix já salva ao reabrir o Cadastro de Colaboradores,
-- mas fa_kiosk_employee_payroll_info só é legível por quem tem
-- folha_pagamento.read (Owner) — expor salário/conta bancária pra qualquer
-- Operador logado é exatamente o que essa tabela foi criada pra evitar.
-- Função estreita: devolve só o pix_key da própria linha, nada mais.
--
-- Stub abaixo: fa_kiosk_employee_payroll_info só ganha sua definição
-- completa (colunas de salário/banco, RLS, capabilities) em
-- 20260807000017_fa_kiosk_payroll.sql, duas migrations depois desta. Como
-- `language sql` (ao contrário de plpgsql) valida a existência das tabelas
-- referenciadas já no CREATE FUNCTION, aplicar as migrations em ordem num
-- banco novo quebrava exatamente aqui (42703: relation does not exist) —
-- reproduzido ao criar um branch de teste do zero. O `create table if not
-- exists` idêntico ao de 017 deixa esta migration autossuficiente; quando
-- 017 rodar depois, o dela é um no-op sobre esta mesma tabela.
create table if not exists fa_kiosk_employee_payroll_info (
  employee_id uuid primary key references fa_kiosk_employees (id) on delete cascade,
  salary_base_cents int,
  bank_code text,
  bank_agencia text,
  bank_agencia_dv text,
  bank_conta text,
  bank_conta_dv text,
  bank_account_type text check (bank_account_type in ('CORRENTE', 'POUPANCA')),
  pix_key text,
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create or replace function fa_kiosk_my_pix()
returns text as $$
  select pix_key from fa_kiosk_employee_payroll_info
   where employee_id = fa_kiosk_current_employee_id();
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_my_pix() from public, anon;
grant execute on function fa_kiosk_my_pix() to authenticated;
