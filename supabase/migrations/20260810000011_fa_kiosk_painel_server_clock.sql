-- =====================================================================
-- Cronômetro do painel do operador ancorado no relógio do servidor
-- =====================================================================
-- Mesmo bug já corrigido em 20260810000002_fa_acompanhar_server_clock.sql
-- (tela do responsável), mas ainda presente no painel do operador
-- (PainelScreen / useTick / computeActiveSessionEntries): o cronômetro
-- "NO PRAZO 00:00" trava porque elapsedMs = Date.now() (do tablet do
-- kiosk) - checkinAtMs (do servidor), e o relógio do tablet pode estar
-- atrasado em relação ao servidor. O client até tentava adivinhar esse
-- desvio a partir das próprias sessões (heurística em client.ts), mas
-- isso falha sempre que não há sessão recente o bastante para revelar o
-- desvio, ou volta a zerar assim que o relógio do tablet "alcança" o
-- checkin — travando de novo ou desalinhando o cronômetro.
--
-- Correção: assim como fa_acompanhar_por_codigo, expõe o instante atual
-- do servidor para o client calcular um offset uma única vez por busca
-- (serverNowMs - Date.now() no momento da resposta) e aplicá-lo a todo
-- Date.now() local do cronômetro — sem depender do relógio do tablet.
create or replace function fa_now_ms() returns bigint as $$
  select (extract(epoch from now()) * 1000)::bigint;
$$ language sql stable;

grant execute on function fa_now_ms() to anon, authenticated, service_role;
