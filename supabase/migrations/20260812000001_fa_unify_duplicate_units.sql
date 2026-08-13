-- Unifica unidades duplicadas com o nome 'Faça Amigos Playground (Parque Shopping)'.
--
-- Contexto: existem hoje 2 linhas em fa_kiosk_units com o mesmo nome
-- 'Faça Amigos Playground (Parque Shopping)' (a migration 20260811000004 já
-- fez isso uma vez para o nome antigo 'Faça Amigos Playground', mas cobria só
-- 4 tabelas — sessions/plans/orders/assets — e não a duplicata atual, que já
-- nasce com o nome oficial). Esta migration generaliza o merge para TODAS as
-- ~24 tabelas com unit_id/source_unit_id/unit_ids que apontam para
-- fa_kiosk_units, escolhe a linha canônica (o id fixo
-- '11111111-1111-1111-1111-111111111111' usado pelo seed, se existir entre as
-- duplicatas; senão a mais antiga) e apaga as demais depois de migrar tudo.
--
-- fa_kiosk_employees.unit_id é tratado à parte (bloco dinâmico) porque existe
-- só no banco live via migration remota não versionada aqui (drift conhecido,
-- ver comentário em 20260810000005_fa_security_audit_ponto_fixes.sql) — o
-- guard por information_schema evita quebrar em ambientes onde a coluna não
-- existe.

do $$
declare
  v_target_id uuid;
  v_dup record;
begin
  -- Unidade canônica: prioriza o id fixo do seed, senão a menor UUID (critério
  -- estável e determinístico). Não ordena por created_at_ms porque o banco
  -- live tem drift de schema conhecido (essa coluna pode não existir aqui,
  -- mesmo estando na migration original de criação da tabela).
  select id into v_target_id
    from fa_kiosk_units
   where name = 'Faça Amigos Playground (Parque Shopping)'
   order by (id = '11111111-1111-1111-1111-111111111111') desc, id asc
   limit 1;

  if v_target_id is null then
    raise notice 'Nenhuma unidade "Faça Amigos Playground (Parque Shopping)" encontrada — nada a fazer.';
    return;
  end if;

  for v_dup in
    select id from fa_kiosk_units
     where name = 'Faça Amigos Playground (Parque Shopping)'
       and id <> v_target_id
  loop
    raise notice 'Unificando unidade duplicada % em %', v_dup.id, v_target_id;

    -- ---- FKs simples (sem unique constraint além do id) -----------------
    update fa_kiosk_plans set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_products set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_bonus_rules set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_loyalty_rules set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_shifts set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_orders set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_assets set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_sessions set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_print_jobs set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_ponto_records set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_fiscal_docs set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_fiscal_inutilizacoes set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_packages set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_guardian_packages set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_upsell_offers set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_payroll_runs set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_birthday_sends set unit_id = v_target_id where unit_id = v_dup.id;
    update fa_kiosk_hour_bank_credits set source_unit_id = v_target_id where source_unit_id = v_dup.id;

    -- ---- fa_kiosk_app_settings: PK (unit_id, key) ------------------------
    -- Se a chave já existe na unidade canônica, mantém o valor canônico e
    -- descarta o da duplicata (evita colisão de PK).
    delete from fa_kiosk_app_settings dup_s
     where dup_s.unit_id = v_dup.id
       and exists (
         select 1 from fa_kiosk_app_settings tgt_s
          where tgt_s.unit_id = v_target_id and tgt_s.key = dup_s.key
       );
    update fa_kiosk_app_settings set unit_id = v_target_id where unit_id = v_dup.id;

    -- ---- fa_kiosk_coupons: unique (unit_id, code) ------------------------
    delete from fa_kiosk_coupons dup_c
     where dup_c.unit_id = v_dup.id
       and exists (
         select 1 from fa_kiosk_coupons tgt_c
          where tgt_c.unit_id = v_target_id and tgt_c.code = dup_c.code
       );
    update fa_kiosk_coupons set unit_id = v_target_id where unit_id = v_dup.id;

    -- ---- fa_kiosk_employee_units: PK (employee_id, unit_id) -------------
    delete from fa_kiosk_employee_units dup_eu
     where dup_eu.unit_id = v_dup.id
       and exists (
         select 1 from fa_kiosk_employee_units tgt_eu
          where tgt_eu.unit_id = v_target_id and tgt_eu.employee_id = dup_eu.employee_id
       );
    update fa_kiosk_employee_units set unit_id = v_target_id where unit_id = v_dup.id;

    -- ---- fa_kiosk_fiscal_terminal_status: PK é o próprio unit_id --------
    -- Um terminal por unidade: se a canônica já tem terminal cadastrado,
    -- mantém o dela (é a que está fisicamente em uso) e descarta o da
    -- duplicata; senão promove o da duplicata para a canônica.
    if exists (select 1 from fa_kiosk_fiscal_terminal_status where unit_id = v_target_id) then
      delete from fa_kiosk_fiscal_terminal_status where unit_id = v_dup.id;
    else
      update fa_kiosk_fiscal_terminal_status set unit_id = v_target_id where unit_id = v_dup.id;
    end if;

    -- ---- fa_kiosk_fiscal_numbering: PK (unit_id, doc_type, environment, serie)
    -- Numeração fiscal é dado legal — nunca "perder" a contagem mais alta já
    -- usada. Em conflito, mantém a faixa com maior next_number (a mais
    -- avançada) para não arriscar reemitir um número de NFC-e já usado.
    update fa_kiosk_fiscal_numbering tgt_n
       set next_number = dup_n.next_number
      from fa_kiosk_fiscal_numbering dup_n
     where dup_n.unit_id = v_dup.id
       and tgt_n.unit_id = v_target_id
       and tgt_n.doc_type = dup_n.doc_type
       and tgt_n.environment = dup_n.environment
       and tgt_n.serie = dup_n.serie
       and dup_n.next_number > tgt_n.next_number;
    delete from fa_kiosk_fiscal_numbering dup_n
     where dup_n.unit_id = v_dup.id
       and exists (
         select 1 from fa_kiosk_fiscal_numbering tgt_n
          where tgt_n.unit_id = v_target_id
            and tgt_n.doc_type = dup_n.doc_type
            and tgt_n.environment = dup_n.environment
            and tgt_n.serie = dup_n.serie
       );
    update fa_kiosk_fiscal_numbering set unit_id = v_target_id where unit_id = v_dup.id;

    -- ---- fa_kiosk_onboarding_invites.unit_ids: array uuid[] -------------
    update fa_kiosk_onboarding_invites
       set unit_ids = (
         select array_agg(distinct x) from unnest(array_replace(unit_ids, v_dup.id, v_target_id)) x
       )
     where v_dup.id = any(unit_ids);

    -- ---- fa_kiosk_employees.unit_id: drift live, coluna não versionada --
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'fa_kiosk_employees' and column_name = 'unit_id'
    ) then
      execute 'update fa_kiosk_employees set unit_id = $1 where unit_id = $2' using v_target_id, v_dup.id;
    end if;

    -- ---- Remove a linha duplicada de fa_kiosk_units ----------------------
    delete from fa_kiosk_units where id = v_dup.id;
  end loop;

  -- Garante o nome oficial na unidade canônica.
  update fa_kiosk_units
     set name = 'Faça Amigos Playground (Parque Shopping)'
   where id = v_target_id;
end $$;
