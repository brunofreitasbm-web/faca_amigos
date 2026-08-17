-- GPS geofence por unidade (Frequência de Estagiários — gap vs. o sistema
-- irmão "Porto Terapia", que já valida distância ao bater ponto).
--
-- Colunas opcionais: unidade sem geofence configurado (NULL em qualquer uma
-- das três) não passa a bloquear ponto por localização — só quando o Owner
-- de fato preenche latitude/longitude/raio em Configurações > Unidade é que
-- fa_register_ponto (ver migration seguinte) passa a exigir e validar GPS.
alter table fa_kiosk_units add column if not exists latitude numeric;
alter table fa_kiosk_units add column if not exists longitude numeric;
alter table fa_kiosk_units add column if not exists geofence_radius_m integer;

-- fa_config_update_unit ganha os 3 campos novos. CREATE OR REPLACE com a
-- MESMA assinatura (p_unit_id uuid, p_payload jsonb) — ao contrário de
-- fa_register_ponto na próxima migration, aqui não há overload a limpar.
create or replace function fa_config_update_unit(p_unit_id uuid, p_payload jsonb) returns void as $$
begin
  if not fa_kiosk_can('config.unit.write') then
    raise exception 'sem permissão para editar a unidade' using errcode = '42501';
  end if;

  update fa_kiosk_units set
    name                     = coalesce(fa_config_text(p_payload, 'name'), name),
    timezone                 = coalesce(fa_config_text(p_payload, 'timezone'), timezone),
    business_day_cutoff_hour = coalesce((p_payload ->> 'businessDayCutoffHour')::int, business_day_cutoff_hour),
    address                  = fa_config_text(p_payload, 'address'),
    phone                    = fa_config_digits(p_payload, 'phone'),
    latitude                 = (p_payload ->> 'latitude')::numeric,
    longitude                = (p_payload ->> 'longitude')::numeric,
    geofence_radius_m        = (p_payload ->> 'geofenceRadiusM')::int
  where id = p_unit_id;

  if not found then
    raise exception 'unidade não encontrada' using errcode = 'P0002';
  end if;

  perform fa_config_audit('CONFIG_UNIT_UPDATE', jsonb_build_object('unitId', p_unit_id, 'payload', p_payload));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
