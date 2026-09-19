-- =====================================================================
-- Aluguel avulso de pelúcia no Playground (Parque Shopping) — Passo 1 / 4
-- =====================================================================
-- O Playground passa a alugar, de vez em quando, uma pelúcia cronometrada
-- (R$ 48 / 20 min, excedente R$ 3/min). O dinheiro entra no caixa do
-- Playground, mas a locação NÃO pode:
--   * contar como locação do Circuito (a PELÚCIA CACHORRO sai de lá);
--   * inflar a meta de faturamento do Playground nem o denominador do
--     bônus "45% das sessões >= 1h".
-- Em troca, cada aluguel conta como 1 produto (R$ 2) para quem fechou o
-- pedido — ver docs/bonificacao/apuracao_bonificacao.sql.
--
-- Marca: `fa_kiosk_sessions.rental_kind`, gravada pelo fa_checkin a
-- partir de `fa_kiosk_plans.asset_kind` (plano PLAYGROUND com asset_kind
-- preenchido = aluguel). Fica na sessão, e não só no plano, porque o
-- Gerencial pode editar/desativar o plano depois e a apuração precisa
-- continuar enxergando o aluguel. Sem activity nova: o check
-- 'PLAYGROUND'|'CARRINHO' está espalhado por tipos TS, fidelidade,
-- Painel e Saída — a sessão continua sendo do Playground.
-- =====================================================================

alter table fa_kiosk_sessions add column if not exists rental_kind text
  check (rental_kind in ('PELUCIA'));

create index if not exists fa_kiosk_sessions_rental_idx
  on fa_kiosk_sessions (unit_id, business_date) where rental_kind is not null;

-- PELÚCIA CACHORRO: sai do Circuito e fica fixa no Playground (decisão do
-- dono, 2026-09-19). Estava cadastrada como kind='CARRO'. Se estiver
-- EM_USO numa sessão do Circuito na hora do deploy, não tem problema: o
-- fa_checkout libera o ativo por id, sem olhar a unidade.
update fa_kiosk_assets
   set unit_id = '11111111-1111-1111-1111-111111111111',
       kind = 'PELUCIA',
       emoji = '🧸'
 where id = '40304b1e-63b1-4be0-b9c2-531f7a67ce0e';

-- Plano único do aluguel. Só existe em bancos com a unidade Playground
-- do Parque Shopping (produção); o `where exists` evita erro em ambientes
-- de desenvolvimento sem ela.
insert into fa_kiosk_plans (unit_id, activity, name, value_cents, duration_value, duration_unit,
                            overage_cents_per_minute, asset_kind, color, active)
select '11111111-1111-1111-1111-111111111111', 'PLAYGROUND', 'Pelúcia (20 min)', 4800, 20, 'MINUTO',
       300, 'PELUCIA', '#C084FC', true
 where exists (select 1 from fa_kiosk_units where id = '11111111-1111-1111-1111-111111111111')
   and not exists (select 1 from fa_kiosk_plans
                    where unit_id = '11111111-1111-1111-1111-111111111111'
                      and activity = 'PLAYGROUND' and asset_kind = 'PELUCIA');
