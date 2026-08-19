import type { SupabaseClient } from "@supabase/supabase-js";
import { bloquearNfsePorFaltaDeTransporteReal, processarNfseSimulado } from "./nfse.js";

/**
 * Consumidor da fila `fa_kiosk_fiscal_docs` (Fase 3 do plano). Reivindica
 * documentos pendentes via `fa_fiscal_claim_next` — que usa
 * `for update skip locked` no Postgres — e por isso dois terminais rodando
 * ao mesmo tempo se revezam em vez de emitir nota duplicada. Isso falta no
 * print bridge de hoje; o worker fiscal não pode repetir esse antipadrão.
 *
 * Modo SIMULADO (`FACAAMIGOS_FISCAL_MODE=SIMULADO`): marca o documento como
 * AUTORIZADO com uma chave falsa, sem tocar em certificado nem em rede da
 * SEFAZ. Existe para validar a mecânica da fila (fila durável, catch-up no
 * boot, ausência de duplicação) ANTES de existir qualquer risco fiscal real
 * — exatamente o critério de verificação da Fase 3. A transmissão de
 * verdade (assinatura + SVRS) é Fase 5/6, ainda não implementada: fora do
 * modo simulado, o documento é marcado BLOQUEADO com um motivo claro, para
 * não entrar num loop de retentativa sem sentido.
 */

export interface ClaimedFiscalDoc {
  doc: {
    id: string;
    docType: string;
    environment: "HOMOLOGACAO" | "PRODUCAO";
    status: string;
    emissionType: string;
    serie: string | null;
    numero: number | null;
    accessKey: string | null;
    attempts: number;
    totalCents: number;
  };
  order: { id: string; orderCode: string; businessDate: string };
  unit: { id: string; cnpj: string | null };
  items: unknown[];
  payments: unknown[];
}

export interface ClaimDeps {
  supabase: SupabaseClient;
  terminalId: string;
  simulado: boolean;
  onLog?: (message: string) => void;
}

/** Chave de acesso falsa, só para o modo simulado — nunca passa perto de um XSD/QR Code real. */
function chaveFalsa(docId: string): string {
  const digits = docId.replace(/\D/g, "").padEnd(44, "0").slice(0, 44);
  return digits;
}

async function processarDocumentoSimulado(supabase: SupabaseClient, doc: ClaimedFiscalDoc["doc"]): Promise<void> {
  const nowMs = Date.now();
  await supabase
    .from("fa_kiosk_fiscal_docs")
    .update({
      status: "AUTORIZADO",
      access_key: chaveFalsa(doc.id),
      numero: doc.numero ?? 1,
      serie: doc.serie ?? "1",
      protocol_number: `SIMULADO-${doc.id.slice(0, 8)}`,
      authorized_at_ms: nowMs,
      updated_at_ms: nowMs,
    })
    .eq("id", doc.id);
}

async function bloquearPorFaltaDeTransporteReal(supabase: SupabaseClient, doc: ClaimedFiscalDoc["doc"]): Promise<void> {
  const nowMs = Date.now();
  await supabase
    .from("fa_kiosk_fiscal_docs")
    .update({
      status: "BLOQUEADO",
      last_error: "Transporte real da NFC-e (SVRS) ainda não implementado — Fase 5 do plano. " +
        "Rode com FACAAMIGOS_FISCAL_MODE=SIMULADO para validar a fila, ou espere a Fase 5/6.",
      updated_at_ms: nowMs,
    })
    .eq("id", doc.id);
}

/** Uma passada de claim + processamento. Retorna quantos documentos tratou. */
export async function runFiscalClaimOnce(deps: ClaimDeps, limit = 5): Promise<number> {
  const { data, error } = await deps.supabase.rpc("fa_fiscal_claim_next", {
    p_terminal_id: deps.terminalId,
    p_limit: limit,
  });
  if (error) {
    deps.onLog?.(`[fiscal] fa_fiscal_claim_next falhou: ${error.message}`);
    return 0;
  }

  const claimed = (data ?? []) as ClaimedFiscalDoc[];
  for (const item of claimed) {
    try {
      if (item.doc.docType === "NFSE") {
        if (deps.simulado) {
          await processarNfseSimulado(deps.supabase, item);
          deps.onLog?.(`[fiscal] NFS-e ${item.doc.id} (venda ${item.order.orderCode}) autorizada (SIMULADO).`);
        } else {
          await bloquearNfsePorFaltaDeTransporteReal(deps.supabase, item.doc);
        }
      } else if (deps.simulado) {
        await processarDocumentoSimulado(deps.supabase, item.doc);
        deps.onLog?.(`[fiscal] documento ${item.doc.id} (venda ${item.order.orderCode}) autorizado (SIMULADO).`);
      } else {
        await bloquearPorFaltaDeTransporteReal(deps.supabase, item.doc);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.onLog?.(`[fiscal] documento ${item.doc.id} falhou: ${message}`);
    }
  }
  return claimed.length;
}
