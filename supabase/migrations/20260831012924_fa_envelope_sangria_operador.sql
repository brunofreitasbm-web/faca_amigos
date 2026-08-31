-- fa_kiosk_guard_cash_movement (migration 20260807000006) exige a capacidade
-- 'caixa.sangria' (Líder/Owner) para qualquer SANGRIA/SUPRIMENTO/AJUSTE. Isso
-- bloqueava também o Operador que fecha o próprio caixa e registra o envelope
-- com a foto — ele já tem 'caixa.open_close' e o envelope + foto SÃO a
-- prestação de contas daquele valor, então não precisa da capacidade extra.
--
-- Regra fica: envelope de fechamento (SANGRIA com envelope_number e photo_url
-- preenchidos) libera para quem pode abrir/fechar caixa. Sangria/suprimento/
-- ajuste avulsos (sem envelope, feitos pelo card "Sangria/Suprimento") seguem
-- exigindo 'caixa.sangria'.
create or replace function fa_kiosk_guard_cash_movement() returns trigger as $$
begin
  if fa_kiosk_current_employee_id() is null then
    return new;  -- service_role / seed
  end if;

  if new.kind = 'SANGRIA' and new.envelope_number is not null and new.photo_url is not null then
    if not fa_kiosk_can('caixa.open_close') then
      raise exception 'apenas quem pode abrir/fechar o caixa pode registrar o envelope'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.kind in ('SANGRIA', 'SUPRIMENTO', 'AJUSTE') and not fa_kiosk_can('caixa.sangria') then
    raise exception 'apenas um líder ou o proprietário pode registrar sangria, suprimento ou ajuste'
      using errcode = '42501';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_guard_cash_movement() from public, anon, authenticated;
