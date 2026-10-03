-- =====================================================================
-- fa_kiosk_visit_log: impede visita duplicada (fidelidade indevida)
-- =====================================================================
-- Bug: fa_kiosk_import_legacy_record insere no log de visitas a cada
-- chamada, sem checar duplicidade. A mesma importação rodou várias vezes e
-- gerou ~5,5 mil linhas repetidas (mesma criança, atividade e instante).
-- fa_checkin conta linhas do log para o programa de fidelidade, então
-- crianças em 1ª visita chegaram à "10ª" e receberam 30 min de cortesia —
-- no Painel o cronômetro ficava em 00:00 e o valor em R$ 0,00.
--
-- As linhas duplicadas já foram removidas em produção (backup em
-- backups.fa_kiosk_visit_log_20261003). Esta migration impede a volta:
--   1. índice único: garantia dura, vale também sob concorrência;
--   2. gatilho BEFORE INSERT: descarta o insert repetido em silêncio, para
--      que a importação legada e o check-in não falhem por causa disso.

-- Segurança caso a migration rode num banco que ainda tenha duplicadas.
with ranked as (
  select id, row_number() over (partition by child_id, activity, at_ms order by id) rn
  from fa_kiosk_visit_log
)
delete from fa_kiosk_visit_log v using ranked r where v.id = r.id and r.rn > 1;

create unique index if not exists uq_fa_kiosk_visit_log_child_activity_at
  on fa_kiosk_visit_log (child_id, activity, at_ms);

create or replace function fa_kiosk_visit_log_skip_duplicate() returns trigger as $$
begin
  if exists (
    select 1 from fa_kiosk_visit_log
    where child_id = new.child_id and activity = new.activity and at_ms = new.at_ms
  ) then
    return null;
  end if;
  return new;
end;
$$ language plpgsql set search_path = public, pg_temp;

revoke execute on function fa_kiosk_visit_log_skip_duplicate() from public, anon, authenticated;

drop trigger if exists trg_fa_kiosk_visit_log_skip_duplicate on fa_kiosk_visit_log;
create trigger trg_fa_kiosk_visit_log_skip_duplicate
  before insert on fa_kiosk_visit_log
  for each row execute function fa_kiosk_visit_log_skip_duplicate();
