-- =====================================================================
-- Atualização Fiscais / CNPJ e RPC Gerencial de Clientes
-- =====================================================================

-- 1. Atualização dos dados cadastrais das unidades oficiais
update fa_kiosk_units
set
  cnpj = '66.318.630/0001-17',
  address = 'Rod. Augusto Montenegro, 4300 - Parque Shopping Belém, Piso PSB01003, Parque Verde, Belém/PA - CEP 66635-110',
  phone = '(91) 98250-1215'
where name ilike '%Parque%' or name ilike '%Circuito%';

-- 2. RPC para listar a base de clientes (responsáveis + crianças) no Gerencial
create or replace function fa_gerencial_clientes(
  p_search text default null,
  p_unit_id uuid default null
) returns jsonb as $$
declare
  v_search text := trim(coalesce(p_search, ''));
  v_res jsonb;
begin
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_res
  from (
    select
      g.id as guardian_id,
      g.full_name as guardian_name,
      g.cpf,
      g.phone_e164,
      g.email,
      g.created_at,
      (
        select count(distinct s.id)
        from fa_kiosk_sessions s
        where s.guardian_id = g.id
          and (p_unit_id is null or s.unit_id = p_unit_id)
      ) as total_visits,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id,
          'fullName', c.full_name,
          'birthDate', c.birth_date,
          'photoPath', c.photo_path
        )), '[]'::jsonb)
        from fa_kiosk_child_guardians cg
        join fa_kiosk_children c on c.id = cg.child_id
        where cg.guardian_id = g.id
      ) as children
    from fa_kiosk_guardians g
    where (
      v_search = '' or
      g.full_name ilike '%' || v_search || '%' or
      g.cpf ilike '%' || v_search || '%' or
      g.phone_e164 ilike '%' || v_search || '%' or
      exists (
        select 1 from fa_kiosk_child_guardians cg2
        join fa_kiosk_children c2 on c2.id = cg2.child_id
        where cg2.guardian_id = g.id and c2.full_name ilike '%' || v_search || '%'
      )
    )
    order by g.created_at desc
    limit 150
  ) item;

  return v_res;
end;
$$ language plpgsql stable security definer;
