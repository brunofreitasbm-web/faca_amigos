alter table fa_kiosk_units add column if not exists opening_hour_mon_sat text;
alter table fa_kiosk_units add column if not exists closing_hour_mon_sat text;
alter table fa_kiosk_units add column if not exists opening_hour_sun text;
alter table fa_kiosk_units add column if not exists closing_hour_sun text;

create or replace function fa_config_update_unit(p_unit_id uuid, p_payload jsonb) returns void as $$
declare
  v_unit_name text;
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
    geofence_radius_m        = (p_payload ->> 'geofenceRadiusM')::int,
    opening_hour_mon_sat     = coalesce(fa_config_text(p_payload, 'openingHourMonSat'), opening_hour_mon_sat),
    closing_hour_mon_sat     = coalesce(fa_config_text(p_payload, 'closingHourMonSat'), closing_hour_mon_sat),
    opening_hour_sun         = coalesce(fa_config_text(p_payload, 'openingHourSun'), opening_hour_sun),
    closing_hour_sun         = coalesce(fa_config_text(p_payload, 'closingHourSun'), closing_hour_sun)
  where id = p_unit_id
  returning name into v_unit_name;

  if not found then
    raise exception 'unidade não encontrada' using errcode = 'P0002';
  end if;

  -- Sincronização automática de horários entre unidades do Parque Shopping
  if v_unit_name ilike '%Parque Shopping%' then
    update fa_kiosk_units set
      opening_hour_mon_sat = coalesce(fa_config_text(p_payload, 'openingHourMonSat'), opening_hour_mon_sat),
      closing_hour_mon_sat = coalesce(fa_config_text(p_payload, 'closingHourMonSat'), closing_hour_mon_sat),
      opening_hour_sun     = coalesce(fa_config_text(p_payload, 'openingHourSun'), opening_hour_sun),
      closing_hour_sun     = coalesce(fa_config_text(p_payload, 'closingHourSun'), closing_hour_sun)
    where name ilike '%Parque Shopping%' and id != p_unit_id;
  end if;

  perform fa_config_audit('CONFIG_UNIT_UPDATE', jsonb_build_object('unitId', p_unit_id, 'payload', p_payload));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
