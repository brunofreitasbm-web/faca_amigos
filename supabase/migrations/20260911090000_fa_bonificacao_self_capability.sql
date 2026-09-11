-- Menu "Minha Bonificação" (individual, somente leitura): cada colaborador
-- consulta seus próprios ticket médio, progresso de meta e acumulado do
-- mês, sem depender do gerente (ver manual-operadores.md, FAQ "Onde eu vejo
-- quanto já ganhei no mês?").
--
-- Declarada no papel mínimo (OPERADOR): por herança hierárquica
-- (fa_kiosk_role_rank, ver 20260807000002_fa_rbac_capabilities.sql),
-- GERENTE e ADMIN também recebem a capacidade automaticamente — não há como
-- conceder a OPERADOR/GERENTE sem estender a ADMIN neste modelo de RBAC.
-- Sem problema: a apuração (apuracao_bonificacao.sql / apuracaoBonificacao.ts)
-- já exclui role = 'ADMIN' do programa, então o Owner só vê a tela vazia.
-- Estagiário e Prestador PJ não participam e ficam abaixo do rank mínimo.

insert into fa_kiosk_role_capabilities (role, capability) values
  ('OPERADOR', 'bonificacao.self')
on conflict do nothing;
