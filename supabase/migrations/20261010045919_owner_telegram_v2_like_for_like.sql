-- EXPORTADA da produção (supabase_migrations.schema_migrations, versão
-- 20261010045919, aplicada por brunofreitasbm@gmail.com em 2026-10-10). O SQL
-- abaixo é o texto aplicado, sem alterações; só este cabeçalho foi acrescentado
-- para o repositório voltar a refletir a produção. NÃO reaplicar na produção.

do $do$
declare
  v_def text; v_new text;
begin
  -- DIÁRIO
  v_def := pg_get_functiondef('public.fa_owner_report_build_resumo_diario(date)'::regprocedure);
  v_new := replace(v_def, 'v_tot_ant bigint; v_var numeric;', 'v_tot_ant bigint; v_tot_cmp bigint; v_var numeric;');
  if v_new = v_def then raise exception 'diario: declaracao nao encontrada'; end if;
  v_def := v_new;
  v_new := replace(v_def,
    'v_var := case when v_tot_ant > 0 then round((v_tot_fat - v_tot_ant)::numeric / v_tot_ant * 100, 1) else null end;',
    $r$select coalesce(sum(total_cents), 0) into v_tot_cmp
    from fa_kiosk_orders
    where business_date = v_date and status = 'PAGA'
      and unit_id in (select unit_id from fa_kiosk_orders where business_date = v_date - 7 and status = 'PAGA');
  v_var := case when v_tot_ant > 0 then round((v_tot_cmp - v_tot_ant)::numeric / v_tot_ant * 100, 1) else null end;$r$);
  if v_new = v_def then raise exception 'diario: calculo nao encontrado'; end if;
  v_def := v_new;
  v_new := replace(v_def, ', vs mesmo dia da semana anterior: ', ', vs mesmo dia da semana anterior (mesmas unidades): ');
  if v_new = v_def then raise exception 'diario: rotulo nao encontrado'; end if;
  execute v_new;

  -- SEMANAL
  v_def := pg_get_functiondef('public.fa_owner_report_build_resumo_semanal_consolidado()'::regprocedure);
  v_new := replace(v_def, 'v_tot_fat bigint := 0; v_tot_fat_ant bigint := 0;', 'v_tot_fat bigint := 0; v_tot_cmp bigint := 0; v_tot_fat_ant bigint := 0;');
  if v_new = v_def then raise exception 'semanal: declaracao nao encontrada'; end if;
  v_def := v_new;
  v_new := replace(v_def, 'v_tot_fat := v_tot_fat + v_fat; v_tot_fat_ant := v_tot_fat_ant + v_fat_ant;',
    'v_tot_fat := v_tot_fat + v_fat; v_tot_fat_ant := v_tot_fat_ant + v_fat_ant; if v_fat_ant > 0 then v_tot_cmp := v_tot_cmp + v_fat; end if;');
  if v_new = v_def then raise exception 'semanal: acumulo nao encontrado'; end if;
  v_def := v_new;
  v_new := replace(v_def, 'case when v_tot_fat >= v_tot_fat_ant then', 'case when v_tot_cmp >= v_tot_fat_ant then');
  v_new := replace(v_new, 'round((v_tot_fat - v_tot_fat_ant)::numeric / v_tot_fat_ant * 100, 1) ||', 'round((v_tot_cmp - v_tot_fat_ant)::numeric / v_tot_fat_ant * 100, 1) ||');
  v_new := replace(v_new, '% vs semana anterior)', '% vs semana anterior, mesmas unidades)');
  if v_new = v_def then raise exception 'semanal: formula nao encontrada'; end if;
  execute v_new;
end
$do$;
