/**
 * Ponto de encontro entre a rota HTTP que amarra o terminal a uma
 * unidade (`POST /api/system/terminal-unit`) e o print bridge, que roda
 * no processo main.
 *
 * Existe como módulo próprio, sem importar `electron` nem
 * `@supabase/supabase-js`, para a rota não precisar arrastar o bridge
 * inteiro — e para o teste das rotas rodar sem Electron.
 */
type RebindHandler = () => void;

let handler: RebindHandler | null = null;

export function onPrintBridgeRebind(fn: RebindHandler | null): void {
  handler = fn;
}

/**
 * Pede ao print bridge para reler a unidade amarrada e reassinar o
 * Realtime. Sem isto, amarrar o terminal na tela só passaria a valer no
 * próximo reinício do app — e o operador concluiria que não funcionou.
 * No-op quando o bridge não subiu (ex.: rodando fora do Electron).
 */
export function rebindPrintBridge(): void {
  try {
    handler?.();
  } catch (err) {
    console.error("[print-bridge] falha ao reassinar após troca de unidade do terminal:", err);
  }
}
