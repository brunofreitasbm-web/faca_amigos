-- Reconhecimento facial no quiosque (gap vs. Porto Terapia). O descriptor é
-- o vetor de 128 floats do face-api.js/@vladmandic face-api, guardado como
-- jsonb — nunca a foto de rosto crua; a foto de cadastro fica em Storage,
-- referenciada só pelo path.
alter table fa_kiosk_employees add column if not exists face_descriptor jsonb;
alter table fa_kiosk_employees add column if not exists face_enrolled_photo_path text;

-- Bucket privado para foto de cadastro do rosto E para a foto tirada em
-- cada marcação de ponto (coluna punch_photo_path, ver próxima migration) —
-- mesmo bucket, path sempre prefixado por employee_id, arquivo distinguido
-- pelo nome (enroll-*.jpg vs punch-*.jpg).
insert into storage.buckets (id, name, public)
values ('ponto-fotos', 'ponto-fotos', false)
on conflict (id) do nothing;

-- Upload só no próprio "diretório" (1º segmento do path = employee_id do
-- chamador) — nunca a foto de outro colaborador, nem no cadastro do rosto
-- nem na marcação de ponto. kiosk-ui já usa sessão Supabase Auth real por
-- colaborador neste módulo (fa_kiosk_current_employee_id), diferente do
-- upload ainda anônimo de crianca-fotos (migration 20260807000009).
drop policy if exists fa_kiosk_ponto_fotos_write on storage.objects;
create policy fa_kiosk_ponto_fotos_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ponto-fotos'
    and (storage.foldername(name))[1] = fa_kiosk_current_employee_id()::text
  );

-- Leitura: o próprio colaborador (para conferir o cadastro) ou quem tem
-- relatorio.ponto/folha_pagamento.read (mesmo gate de quem lê
-- fa_kiosk_ponto_records, migration 20260810000005) — auditoria de ponto
-- sem poder ver a foto que comprova a marcação não faz sentido.
drop policy if exists fa_kiosk_ponto_fotos_read on storage.objects;
create policy fa_kiosk_ponto_fotos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'ponto-fotos'
    and (
      (storage.foldername(name))[1] = fa_kiosk_current_employee_id()::text
      or fa_kiosk_can('relatorio.ponto')
      or fa_kiosk_can('folha_pagamento.read')
    )
  );

-- Cadastro/atualização do rosto: o próprio colaborador (autoatendimento,
-- inclusive ESTAGIARIO) ou quem tem config.employees.write. Descriptor
-- facial é dado biométrico sensível (LGPD art. 5º, II) — por isso nunca um
-- UPDATE cru do cliente na tabela de colaboradores, sempre por esta função,
-- que também deixa rastro no audit log (severidade ALERTA, como as demais
-- alterações administrativas sensíveis em fa_config_audit).
create or replace function fa_kiosk_enroll_face(p_employee_id uuid, p_descriptor jsonb, p_photo_path text) returns void as $$
declare
  v_caller_id uuid := fa_kiosk_current_employee_id();
begin
  if v_caller_id is null then
    raise exception 'não autenticado';
  end if;
  if p_employee_id <> v_caller_id and not fa_kiosk_can('config.employees.write') then
    raise exception 'sem permissão para cadastrar o rosto de outro colaborador' using errcode = '42501';
  end if;

  update fa_kiosk_employees
     set face_descriptor = p_descriptor,
         face_enrolled_photo_path = p_photo_path
   where id = p_employee_id;

  if not found then
    raise exception 'colaborador não encontrado' using errcode = 'P0002';
  end if;

  insert into fa_kiosk_audit_log (employee_id, action, severity, details_json)
  values (v_caller_id, 'FACE_ENROLLED', 'ALERTA', jsonb_build_object('employeeId', p_employee_id));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_enroll_face(uuid, jsonb, text) from public, anon;
grant execute on function fa_kiosk_enroll_face(uuid, jsonb, text) to authenticated;
