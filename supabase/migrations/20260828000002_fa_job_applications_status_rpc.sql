-- Migration: fa_job_applications_status_rpc
-- Garante a atualização segura e resiliente de status no Banco de Talentos

do $$
declare
  r record;
begin
  for r in (
    select conname
    from pg_constraint con
    join pg_class cl on con.conrelid = cl.oid
    where cl.relname = 'fa_kiosk_job_applications'
      and con.contype = 'c'
  ) loop
    execute format('alter table fa_kiosk_job_applications drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table fa_kiosk_job_applications
  add constraint fa_kiosk_job_applications_status_check
  check (status in ('NOVO', 'LIDO', 'ESPERA', 'ENTREVISTA', 'EM_ANALISE', 'CONTATADO', 'ARQUIVADO'));

-- RPC para alteração de status com bypass RLS controlado e verificação de permissão de talentos
create or replace function fa_update_job_application_status(p_id uuid, p_status text)
returns jsonb as $$
declare
  v_updated fa_kiosk_job_applications%rowtype;
begin
  if not (fa_kiosk_can('talentos.write') or fa_kiosk_can('talentos.read')) then
    raise exception 'Acesso negado: permissão para Banco de Talentos necessária';
  end if;

  update fa_kiosk_job_applications
     set status = p_status
   where id = p_id
  returning * into v_updated;

  if not found then
    raise exception 'Candidatura não encontrada';
  end if;

  return to_jsonb(v_updated);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke all on function fa_update_job_application_status(uuid, text) from public, anon;
grant execute on function fa_update_job_application_status(uuid, text) to authenticated;
