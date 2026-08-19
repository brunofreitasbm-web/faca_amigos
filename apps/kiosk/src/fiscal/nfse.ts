import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedFiscalDoc } from "./claim.js";

/**
 * Processamento de NFS-e (sessão de brincar = serviço) dentro da mesma
 * fila/worker da NFC-e (ver claim.ts). Duas diferenças relevantes:
 *
 *  1. NFS-e não tem "chave de acesso" (isso é conceito de NF-e/NFC-e,
 *     SEFAZ) — a numeração é RPS -> NFS-e, municipal, por isso usa
 *     `fa_fiscal_reserve_number` com doc_type='NFSE' em vez de uma chave
 *     de 44 dígitos inventada.
 *  2. A prefeitura de Belém usa sistema próprio, layout ainda não
 *     confirmado — a transmissão real fica BLOQUEADA até isso ser
 *     resolvido (mesma estratégia da NFC-e, que também está bloqueada
 *     aguardando a Fase 5/6 do SVRS).
 *
 * A entrega ao Responsável NÃO acontece aqui: depois de AUTORIZADO, o
 * kiosk-ui mostra o botão "Enviar NFS-e por WhatsApp" (CheckoutModal),
 * que abre o wa.me com o comprovante e registra o envio via
 * fa_fiscal_mark_nfse_sent. Sem e-mail/Resend por decisão de produto.
 */

async function reservarNumeroRps(supabase: SupabaseClient, doc: ClaimedFiscalDoc["doc"], unitId: string): Promise<number> {
  const { data, error } = await supabase.rpc("fa_fiscal_reserve_number", {
    p_unit_id: unitId,
    p_doc_type: "NFSE",
    p_environment: doc.environment,
    p_serie: doc.serie ?? "1",
  });
  if (error) throw new Error(`fa_fiscal_reserve_number (NFSE) falhou: ${error.message}`);
  return data as number;
}

export async function processarNfseSimulado(supabase: SupabaseClient, item: ClaimedFiscalDoc): Promise<void> {
  const { doc, unit } = item;
  const numero = await reservarNumeroRps(supabase, doc, unit.id);
  const nowMs = Date.now();
  await supabase
    .from("fa_kiosk_fiscal_docs")
    .update({
      status: "AUTORIZADO",
      rps_numero: numero,
      numero,
      nfse_numero: String(numero),
      protocol_number: `SIMULADO-${doc.id.slice(0, 8)}`,
      authorized_at_ms: nowMs,
      updated_at_ms: nowMs,
    })
    .eq("id", doc.id);
}

export async function bloquearNfsePorFaltaDeTransporteReal(supabase: SupabaseClient, doc: ClaimedFiscalDoc["doc"]): Promise<void> {
  const nowMs = Date.now();
  await supabase
    .from("fa_kiosk_fiscal_docs")
    .update({
      status: "BLOQUEADO",
      last_error: "Transmissão real de NFS-e (prefeitura de Belém, sistema próprio) ainda não implementada: " +
        "layout/WSDL do webservice municipal pendente de confirmação. Rode com FACAAMIGOS_FISCAL_MODE=SIMULADO " +
        "para validar a fila e o envio por WhatsApp.",
      updated_at_ms: nowMs,
    })
    .eq("id", doc.id);
}
