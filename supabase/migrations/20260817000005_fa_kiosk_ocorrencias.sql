-- Aba admin "Ocorrências" (atestado/falta com anexo), gap vs. Porto Terapia
-- OcorrenciasTab. Diferente de fa_kiosk_ponto_records, isto NÃO é a
-- marcação legal de jornada (Portaria MTP 671/2021) — é uma anotação
-- administrativa de RH sobre um afastamento, lançada por quem tem
-- ocorrencias.write, não pelo próprio colaborador. Ainda assim sem policy
-- de DELETE por padrão: correção de um lançamento errado é feita com uma
-- nova ocorrência, não editando/apagando a anterior.
create table if not exists fa_kiosk_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references fa_kiosk_employees (id),
  unit_id uuid not null references fa_kiosk_units (id),
  tipo text not null check (tipo in ('ATESTADO', 'FALTA')),
  days_away integer not null default 1,
  document_path text,
  notes text,
  created_by_employee_id uuid references fa_kiosk_employees (id),
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists idx_fa_kiosk_ocorrencias_employee on fa_kiosk_ocorrencias (employee_id, created_at_ms);

alter table fa_kiosk_ocorrencias enable row level security;

drop policy if exists fa_kiosk_ocorrencias_read on fa_kiosk_ocorrencias;
create policy fa_kiosk_ocorrencias_read on fa_kiosk_ocorrencias
  for select to authenticated
  using (
    employee_id = fa_kiosk_current_employee_id()
    or fa_kiosk_can('ocorrencias.read')
    or fa_kiosk_can('relatorio.ponto')
  );

-- Sem policy de insert/update/delete direto: só nasce por
-- fa_kiosk_register_ocorrencia (abaixo), que confere ocorrencias.write no
-- servidor antes de gravar, mesmo padrão de fa_register_ponto/fa_config_*.

insert into fa_kiosk_role_capabilities (role, capability) values
  ('GERENTE', 'ocorrencias.read'),
  ('GERENTE', 'ocorrencias.write'),
  ('ADMIN', 'ocorrencias.read'),
  ('ADMIN', 'ocorrencias.write')
on conflict do nothing;

create or replace function fa_kiosk_register_ocorrencia(
  p_idempotency_key text,
  p_employee_id uuid,
  p_unit_id uuid,
  p_tipo text,
  p_days_away integer,
  p_document_path text,
  p_notes text
) returns jsonb as $$
declare
  v_cached jsonb;
  v_id uuid := gen_random_uuid();
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_caller_id uuid := fa_kiosk_current_employee_id();
begin
  if not fa_kiosk_can('ocorrencias.write') then
    raise exception 'sem permissão para lançar ocorrência' using errcode = '42501';
  end if;
  if p_tipo not in ('ATESTADO', 'FALTA') then
    raise exception 'tipo inválido' using errcode = '22023';
  end if;

  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  insert into fa_kiosk_ocorrencias
    (id, employee_id, unit_id, tipo, days_away, document_path, notes, created_by_employee_id, created_at_ms)
    values (v_id, p_employee_id, p_unit_id, p_tipo, coalesce(p_days_away, 1), p_document_path, p_notes, v_caller_id, v_now_ms);

  v_cached := jsonb_build_object('id', v_id, 'atMs', v_now_ms);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_kiosk_register_ocorrencia', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_register_ocorrencia(text, uuid, uuid, text, integer, text, text) from public, anon;
grant execute on function fa_kiosk_register_ocorrencia(text, uuid, uuid, text, integer, text, text) to authenticated;

-- Bucket privado para os anexos (atestado médico etc.), path prefixado por
-- employee_id — mesma regra de ponto-fotos (migration 20260817000003).
-- Tamanho (~2MB) é validado no cliente antes do upload (ver
-- assertValidImageUpload/limite dedicado em lib/imageCompression.ts), não
-- aqui: Storage não recebe um content check de tamanho por policy.
insert into storage.buckets (id, name, public)
values ('ocorrencia-documentos', 'ocorrencia-documentos', false)
on conflict (id) do nothing;

drop policy if exists fa_kiosk_ocorrencia_documentos_write on storage.objects;
create policy fa_kiosk_ocorrencia_documentos_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ocorrencia-documentos'
    and fa_kiosk_can('ocorrencias.write')
  );

drop policy if exists fa_kiosk_ocorrencia_documentos_read on storage.objects;
create policy fa_kiosk_ocorrencia_documentos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'ocorrencia-documentos'
    and (
      (storage.foldername(name))[1] = fa_kiosk_current_employee_id()::text
      or fa_kiosk_can('ocorrencias.read')
    )
  );
