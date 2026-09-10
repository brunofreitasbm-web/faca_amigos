-- =====================================================================
-- Saldo pré-pago da criança — fila do Painel com dados p/ reusar pickMatch (Passo 7 / 8)
-- =====================================================================
-- O "▶ Iniciar" do Painel abre a Entrada pré-preenchida chamando o MESMO
-- pickMatch() que a busca manual usa — um único caminho de código em
-- vez de duas formas de criar sessão (ver decisão no plano: a segunda
-- forma seria mais uma função a manter em sincronia com fa_checkin para
-- sempre, o tipo de drift que já causou bug de cobrança neste repo).
-- Para isso a fila precisa devolver o suficiente para montar um
-- ChildMatch: nascimento, elegibilidade inclusiva e CPF do responsável,
-- que fa_kiosk_child_credit_queue não trazia até aqui.
-- =====================================================================

drop function if exists fa_kiosk_child_credit_queue(uuid);

create or replace function fa_kiosk_child_credit_queue(p_unit_id uuid)
returns table (
  credit_id uuid, child_id uuid, child_name text, child_birth_date date,
  child_inclusive_eligible boolean, guardian_id uuid, guardian_name text,
  guardian_phone text, guardian_cpf text, remaining_minutes integer,
  source_name_snapshot text, activity text, purchased_at_ms bigint,
  has_active_session boolean
) as $$
  select c.id, c.child_id, ch.full_name, ch.birth_date,
         coalesce(ch.inclusive_eligible, false), c.guardian_id, g.full_name,
         g.phone_e164, g.cpf, c.remaining_minutes,
         c.source_name_snapshot, c.activity, c.purchased_at_ms,
         exists(
           select 1 from fa_kiosk_sessions s
            where s.child_id = c.child_id and s.status = 'ATIVA'
         )
    from fa_kiosk_child_time_credits c
    join fa_kiosk_children ch on ch.id = c.child_id
    join fa_kiosk_guardians g on g.id = c.guardian_id
   where c.unit_id = p_unit_id
     and c.cancelled_at_ms is null
     and c.remaining_minutes > 0
   order by c.purchased_at_ms asc
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_child_credit_queue(uuid) from public;
grant execute on function fa_kiosk_child_credit_queue(uuid) to authenticated, service_role;
