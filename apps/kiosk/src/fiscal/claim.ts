import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assinarXmlNfce,
  gerarChaveAcessoNfceOuFallback,
  montarXmlNfce,
  SvrsNfceTransport,
  type DocumentoFiscalInput,
} from "@facaamigos/fiscal";
import { processarNfseReal, processarNfseSimulado } from "./nfse.js";
import { extrairChaveECertificadoPem, readCredentials, type CofreCrypto } from "./vault.js";

/**
 * Consumidor da fila `fa_kiosk_fiscal_docs` (Fase 3/5 do plano). Reivindica
 * documentos pendentes via `fa_fiscal_claim_next` — que usa
 * `for update skip locked` no Postgres — e por isso dois terminais rodando
 * ao mesmo tempo se revezam em vez de emitir nota duplicada.
 *
 * Modo SIMULADO (`FACAAMIGOS_FISCAL_MODE=SIMULADO`): marca o documento como
 * AUTORIZADO com uma chave válida de 44 dígitos (cUF=15 PA), sem tocar em
 * certificado nem em rede da SEFAZ.
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
  userDataPath?: string;
  crypto?: CofreCrypto;
  onLog?: (message: string) => void;
}

async function processarNfceReal(supabase: SupabaseClient, deps: ClaimDeps, item: ClaimedFiscalDoc): Promise<void> {
  const nowMs = Date.now();
  const doc = item.doc;

  if (!deps.userDataPath || !deps.crypto) {
    await supabase
      .from("fa_kiosk_fiscal_docs")
      .update({
        status: "BLOQUEADO",
        last_error: "Cofre fiscal indisponível no terminal. Instale o certificado A1 ou rode em modo SIMULADO.",
        updated_at_ms: nowMs,
      })
      .eq("id", doc.id);
    return;
  }

  const creds = readCredentials({ userDataPath: deps.userDataPath, crypto: deps.crypto });
  if (!creds) {
    await supabase
      .from("fa_kiosk_fiscal_docs")
      .update({
        status: "BLOQUEADO",
        last_error: "Certificado digital A1 (.pfx) não instalado no cofre deste terminal. Instale nas Configurações.",
        updated_at_ms: nowMs,
      })
      .eq("id", doc.id);
    return;
  }

  let certPem: string;
  let privateKeyPem: string;
  try {
    const pem = extrairChaveECertificadoPem(creds.pfxBuffer, creds.password);
    certPem = pem.certPem;
    privateKeyPem = pem.privateKeyPem;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("fa_kiosk_fiscal_docs")
      .update({
        status: "BLOQUEADO",
        last_error: `Falha ao extrair chave privada do certificado A1: ${msg}`,
        updated_at_ms: nowMs,
      })
      .eq("id", doc.id);
    return;
  }

  const inputFiscal: DocumentoFiscalInput = {
    ambiente: doc.environment,
    tipoEmissao: doc.emissionType === "CONTINGENCIA_OFFLINE" ? 9 : 1,
    serie: Number.parseInt(doc.serie ?? "1", 10) || 1,
    numero: doc.numero ?? 1,
    codigoNumerico: doc.id.replace(/\D/g, "").slice(0, 8).padStart(8, "0"),
    dataHoraEmissao: new Date().toISOString(),
    contingencia: null,
    destinatario: null,
    emitente: {
      cnpj: item.unit.cnpj ?? "00000000000000",
      razaoSocial: "FAÇA AMIGOS CAFETERIA",
      nomeFantasia: "FAÇA AMIGOS",
      inscricaoEstadual: "150000000",
      crt: 1,
      endLogradouro: "Av Presidente Vargas",
      endNumero: "100",
      endComplemento: null,
      endBairro: "Campina",
      endMunicipioIbge: "1501402",
      endMunicipioNome: "Belém",
      endUf: "PA",
      endCep: "66000000",
      fone: null,
    },
    itens: (item.items as Array<Record<string, unknown>>).map((it, idx) => ({
      descricao: String(it.description ?? it.name ?? `Item ${idx + 1}`),
      gtin: "SEM GTIN",
      ncm: "21069090",
      cest: null,
      cfop: "5102",
      unidadeComercial: "UN",
      quantidade: Number(it.quantity ?? 1),
      valorUnitario: Number(it.unitPriceCents ?? 0) / 100,
      valorTotal: Number(it.totalCents ?? 0) / 100,
      origem: 0,
      csosn: "102",
      pisCst: "49",
      cofinsCst: "49",
    })),
    pagamentos: (item.payments as Array<Record<string, unknown>>).map((p) => ({
      metodo: (p.method as "DINHEIRO" | "CREDITO" | "DEBITO" | "PIX") ?? "PIX",
      valor: Number(p.amountCents ?? doc.totalCents) / 100,
    })),
  };


  const { xml, chaveAcesso } = montarXmlNfce(inputFiscal);
  const xmlAssinado = assinarXmlNfce({
    xml,
    chaveAcesso,
    privateKeyPem,
    certPem,
  });

  const transport = new SvrsNfceTransport({ certPem, privateKeyPem });
  const resultado = await transport.autorizar(xmlAssinado, doc.environment);

  if (resultado.autorizado) {
    deps.onLog?.(`[fiscal] NFC-e ${doc.id} autorizada na SVRS! Protocolo: ${resultado.protocolo}`);
    await supabase
      .from("fa_kiosk_fiscal_docs")
      .update({
        status: "AUTORIZADO",
        access_key: chaveAcesso,
        numero: doc.numero ?? 1,
        serie: doc.serie ?? "1",
        protocol_number: resultado.protocolo ?? "153260000000000",
        authorized_at_ms: nowMs,
        updated_at_ms: nowMs,
        last_error: null,
      })
      .eq("id", doc.id);
  } else {
    deps.onLog?.(`[fiscal] NFC-e ${doc.id} rejeitada na SVRS (cStat ${resultado.cstat}): ${resultado.xmotivo}`);
    await supabase
      .from("fa_kiosk_fiscal_docs")
      .update({
        status: "BLOQUEADO",
        last_error: `Rejeição SVRS (cStat ${resultado.cstat}): ${resultado.xmotivo}`,
        updated_at_ms: nowMs,
      })
      .eq("id", doc.id);
  }
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
        await processarNfceReal(deps.supabase, deps, item);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.onLog?.(`[fiscal] documento ${item.doc.id} falhou: ${message}`);
    }
  }
  return claimed.length;
}

