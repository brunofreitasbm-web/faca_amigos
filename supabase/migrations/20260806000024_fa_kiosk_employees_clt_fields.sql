-- Campos trabalhistas mínimos exigidos para o módulo de Ponto ter rigor
-- CLT de verdade (cadastro de colaborador em Configurações): CPF completo,
-- e-mail (vira a conta de login real em auth.users), data de nascimento,
-- data de admissão, cargo/função, tipo de contrato e jornada semanal
-- contratada (usada no espelho de ponto para comparar batida x contrato).
-- `cpf_last4` é mantido — outros fluxos já dependem dele.

alter table fa_kiosk_employees
  add column if not exists cpf text,
  add column if not exists email text,
  add column if not exists birth_date date,
  add column if not exists admission_date date,
  add column if not exists position text,
  add column if not exists contract_type text check (contract_type in ('CLT', 'ESTAGIO', 'AUTONOMO')),
  add column if not exists weekly_hours_contracted numeric;
