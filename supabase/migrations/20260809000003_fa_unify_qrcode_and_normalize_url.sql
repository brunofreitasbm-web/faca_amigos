-- =====================================================================
-- Unificação de QR Code e Normalização de URLs
-- =====================================================================
-- Permite que a leitura do QR Code pelo operador (scanner/câmera) aceite
-- tanto o código de acesso simples (ex: K7M2P9QX3B7) quanto a URL completa
-- de acompanhamento do responsável (ex: https://.../?acompanhar=K7M2P9QX3B7).
-- =====================================================================

create or replace function fa_kiosk_normalize_access_code(p_raw text) returns text as $$
declare
  v_str text := coalesce(p_raw, '');
  v_match text;
begin
  if v_str ~* 'acompanhar=' then
    v_match := substring(v_str from '(?i)acompanhar=([^&?#]+)');
    if v_match is not null and v_match <> '' then
      v_str := v_match;
    end if;
  end if;

  return translate(
    regexp_replace(upper(v_str), '[^0-9A-Z]', '', 'g'),
    'ILO', '110'
  );
end;
$$ language plpgsql immutable;
