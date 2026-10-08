-- fa_kiosk_minutes_until_closing: (1) calcula o "hoje" no fuso de Belém — antes usava o fuso da
-- sessão (UTC), então "22:10" valia 19:10 em Belém e check-ins de pacote/saldo/banco de horas
-- depois disso recebiam 0 minuto alocado; (2) aceita exceção por dia da semana depois de ";":
--   "22:10"                  fecha 22:10 todos os dias (formato antigo, continua valendo)
--   "22:10;dom=21:10"        domingo fecha 21:10
-- Dias: dom, seg, ter, qua, qui, sex, sab. Valor inválido continua devolvendo null (sem limite).
create or replace function fa_kiosk_minutes_until_closing(p_now_ms bigint, p_closing_time text)
returns integer
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_parts text[];
  v_base text;
  v_pick text;
  v_part text;
  v_local timestamp := timezone('America/Belem', to_timestamp(p_now_ms / 1000.0));
  v_dow text := (array['dom','seg','ter','qua','qui','sex','sab'])[extract(dow from v_local)::int + 1];
  v_hm text[];
begin
  if p_closing_time is null then return null; end if;
  v_parts := string_to_array(btrim(p_closing_time), ';');
  v_base := btrim(v_parts[1]);
  if v_base !~ '^\d{1,2}:\d{2}$' then return null; end if;
  v_pick := v_base;
  for i in 2 .. coalesce(array_length(v_parts, 1), 1) loop
    v_part := btrim(v_parts[i]);
    if v_part ~ '^(dom|seg|ter|qua|qui|sex|sab)=\d{1,2}:\d{2}$' and split_part(v_part, '=', 1) = v_dow then
      v_pick := split_part(v_part, '=', 2);
    end if;
  end loop;
  v_hm := string_to_array(v_pick, ':');
  return round(extract(epoch from (
    date_trunc('day', v_local) + (v_hm[1] || ' hours')::interval + (v_hm[2] || ' minutes')::interval - v_local
  )) / 60);
end;
$$;

-- Grão-Pará: 22h (+10 min de tolerância, como o Parque) e domingo 21h (+10 min).
insert into fa_kiosk_app_settings (unit_id, key, value, updated_at_ms)
values ('5fc99a57-81ee-4232-a105-1fcb4634cef4', 'closing_time', '22:10;dom=21:10', (extract(epoch from now()) * 1000)::bigint)
on conflict (unit_id, key) do update set value = excluded.value, updated_at_ms = excluded.updated_at_ms;
