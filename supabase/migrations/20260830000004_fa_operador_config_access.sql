-- Concede permissão ao papel OPERADOR (e por herança Líder e Owner) para acessar, ler, editar e salvar Configurações.
--
-- Atualiza a matriz de capacidades mínimas (fa_kiosk_role_capabilities) para que as
-- permissões de configurações passem a ter o papel mínimo OPERADOR.
--
-- Como fa_kiosk_role_rank('OPERADOR') = 1 <= fa_kiosk_role_rank('GERENTE') (2) <= fa_kiosk_role_rank('ADMIN') (3),
-- definir OPERADOR aqui faz a view fa_kiosk_my_capabilities e a função fa_kiosk_can
-- autorizarem Operadores, Líderes e Owners.

do $$
begin
  -- Remover configurações com mínimo de ADMIN para reinserir com mínimo OPERADOR
  delete from fa_kiosk_role_capabilities
   where capability in (
     'config.read',
     'config.write',
     'config.employees.write',
     'config.unit.write',
     'config.fiscal.write',
     'config.terms.write'
   );

  insert into fa_kiosk_role_capabilities (role, capability) values
    ('OPERADOR', 'config.read'),
    ('OPERADOR', 'config.write'),
    ('OPERADOR', 'config.employees.write'),
    ('OPERADOR', 'config.unit.write'),
    ('OPERADOR', 'config.fiscal.write'),
    ('OPERADOR', 'config.terms.write')
  on conflict (role, capability) do update set role = excluded.role;
end $$;
