import type { SupabaseClient } from "@supabase/supabase-js";
import { gerarChaveAcessoNfceOuFallback } from "@facaamigos/fiscal";
import { processarNfseReal, processarNfseSimulado } from "./nfse.js";

/**
 * Consumidor da fila `fa_kiosk_fiscal_docs` (Fase 3 do plano). Reivindica
 * documentos pendentes via `fa_fiscal_claim_next` — que usa
 * `for update skip locked` no Postgres — e por isso dois terminais rodando
 * ao mesmo tempo se revezam em vez de emitir nota duplicada. Isso falta no
 * print bridge de hoje; o worker fiscal não pode repetir esse antipadrão.
 *
 * Modo SIMULADO (`FACAAMIGOS_FISCAL_MODE=SIMULADO`): marca o documento como
 * AUTORIZADO com uma chave válida de 44 dígitos (cUF=15 PA), sem tocar em
 * certificado nem em rede da SEFAZ. Existe para validar a mecânica da fila
 * ANTES de existir qualquer risco fiscal real.
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

async function processarDocumentoSimulado(supabase: SupabaseClient, item: ClaimedFiscalDoc): Promise<void> {
  const nowMs = Date.now();
  const doc = item.doc;
  const accessKey = doc.accessKey && doc.accessKey.length === 44 && !doc.accessKey.startsWith("000000")
    ? doc.accessKey
    : gerarChaveAcessoNfceOuFallback({
        emissaoData: nowMs,
        cnpj: item.unit.cnpj,
        serie: doc.serie,
        numero: doc.numero,
        seedId: doc.id,
      });

  const numericPart = doc.id.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
  const protocolNumber = `15326${numericPart}`;

  await supabase
    .from("fa_kiosk_fiscal_docs")
    .update({
      status: "AUTORIZADO",
      access_key: accessKey,
      numero: doc.numero ?? 1,
      serie: doc.serie ?? "1",
      protocol_number: protocolNumber,
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
          await processarNfseReal(deps.supabase, item, deps.onLog);
        }
      } else if (deps.simulado) {
        await processarDocumentoSimulado(deps.supabase, item);
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
