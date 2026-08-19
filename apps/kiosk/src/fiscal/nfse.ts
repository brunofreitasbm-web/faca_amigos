import type { SupabaseClient } from "@supabase/supabase-js";
import { assinarXmlDps, montarXmlDps, transmitirDps, type DpsInput } from "@facaamigos/fiscal";
import { extrairChaveECertificadoPem } from "./vault.js";
import type { ClaimedFiscalDoc } from "./claim.js";

/**
 * Processamento de NFS-e (sessão de brincar = serviço) dentro da mesma
 * fila/worker da NFC-e (ver claim.ts). Diferenças-chave:
 *
 *  1. NFS-e não tem "chave de acesso" de 44 dígitos (isso é NF-e/NFC-e,
 *     SEFAZ) — a numeração é RPS -> NFS-e, via `fa_fiscal_reserve_number`
 *     com doc_type='NFSE'.
 *  2. Belém usa o Modelo Nacional de NFS-e (ADN/SEFIN Nacional, confirmado
 *     pelo Manual de Contribuintes da Prefeitura em 2026-08-19) — a
 *     transmissão real (`processarNfseReal`) monta e assina a DPS
 *     conforme o XSD público v1.01 e transmite via mTLS ao ADN
 *     (packages/fiscal/src/dps-nacional-*.ts). Ainda pendem confirmações
 *     externas com a prefeitura/contador (convênio "Ativo" para a
 *     alíquota automática, registro no CNC para a IM, código de
 *     tributação nacional exato) — por isso qualquer rejeição da API vira
 *     BLOQUEADO com o motivo cru devolvido pelo ADN, não uma suposição
 *     silenciosa.
 *  3. Sem certificado configurado (fa_kiosk_fiscal_certificates) ou fora
 *     do modo simulado sem `nfse_ambiente`/campos obrigatórios
 *     preenchidos, o documento fica BLOQUEADO com uma mensagem acionável.
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

interface UnitFiscalRow {
  cnpj: string | null;
  inscricao_municipal: string | null;
  nfse_item_lista_servico: string | null;
  nfse_codigo_tributacao_municipio: string | null;
  end_cep: string | null;
  end_logradouro: string | null;
  end_numero: string | null;
  end_complemento: string | null;
  end_bairro: string | null;
  end_municipio_ibge: string | null;
}

async function bloquear(supabase: SupabaseClient, docId: string, motivo: string): Promise<void> {
  const nowMs = Date.now();
  await supabase.from("fa_kiosk_fiscal_docs").update({ status: "BLOQUEADO", last_error: motivo, updated_at_ms: nowMs }).eq("id", docId);
}

/**
 * Transmissão real ao ADN. Cada etapa que pode faltar configuração
 * (unidade sem endereço/código de tributação, sem certificado, sem
 * responsável vinculado) bloqueia o documento com um motivo específico em
 * vez de deixar a exceção genérica confundir quem for investigar depois.
 */
export async function processarNfseReal(supabase: SupabaseClient, item: ClaimedFiscalDoc, onLog?: (message: string) => void): Promise<void> {
  const { doc, order, unit } = item;

  const { data: unitFiscal, error: unitError } = await supabase
    .from("fa_kiosk_units")
    .select(
      "cnpj, inscricao_municipal, nfse_item_lista_servico, nfse_codigo_tributacao_municipio, " +
        "end_cep, end_logradouro, end_numero, end_complemento, end_bairro, end_municipio_ibge",
    )
    .eq("id", unit.id)
    .maybeSingle<UnitFiscalRow>();
  if (unitError || !unitFiscal) {
    await bloquear(supabase, doc.id, `Não foi possível carregar os dados fiscais da unidade: ${unitError?.message ?? "não encontrada"}.`);
    return;
  }
  if (!unitFiscal.cnpj || !unitFiscal.end_cep || !unitFiscal.end_logradouro || !unitFiscal.end_numero || !unitFiscal.end_bairro || !unitFiscal.end_municipio_ibge) {
    await bloquear(supabase, doc.id, "Endereço/CNPJ da unidade incompletos em Configurações → Fiscal — necessários para o grupo de atividade/evento da DPS.");
    return;
  }
  if (!unitFiscal.nfse_item_lista_servico) {
    await bloquear(supabase, doc.id, "Código de tributação nacional (cTribNac) não configurado em Configurações → Fiscal.");
    return;
  }

  const { data: session, error: sessionError } = await supabase
    .from("fa_kiosk_sessions")
    .select("child_name_snapshot, guardian_id")
    .eq("order_id", order.id)
    .order("checkin_at_ms", { ascending: true })
    .limit(1)
    .maybeSingle<{ child_name_snapshot: string | null; guardian_id: string | null }>();
  if (sessionError || !session?.guardian_id) {
    await bloquear(supabase, doc.id, "Pedido sem sessão/responsável vinculado — não é possível montar o tomador da DPS.");
    return;
  }

  const { data: guardian, error: guardianError } = await supabase
    .from("fa_kiosk_guardians")
    .select("cpf, full_name")
    .eq("id", session.guardian_id)
    .maybeSingle<{ cpf: string | null; full_name: string | null }>();
  if (guardianError || !guardian?.cpf) {
    await bloquear(supabase, doc.id, "Responsável sem CPF cadastrado — obrigatório como tomador da DPS.");
    return;
  }

  const { data: certData, error: certError } = await supabase.functions.invoke<{ pfxBase64: string; password: string }>("nfse-certificate-fetch", {
    body: { unitId: unit.id },
  });
  if (certError || !certData) {
    await bloquear(supabase, doc.id, `Certificado A1 não disponível: ${certError?.message ?? "não configurado em Configurações → Fiscal"}.`);
    return;
  }

  let certPem: string;
  let privateKeyPem: string;
  try {
    const pfxBuffer = Buffer.from(certData.pfxBase64, "base64");
    ({ certPem, privateKeyPem } = extrairChaveECertificadoPem(pfxBuffer, certData.password));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await bloquear(supabase, doc.id, `Não foi possível abrir o certificado A1: ${message}`);
    return;
  }

  const numero = await reservarNumeroRps(supabase, doc, unit.id);
  const agora = new Date();

  const dpsInput: DpsInput = {
    ambiente: doc.environment,
    dataHoraEmissao: agora,
    dataCompetencia: agora,
    serieDps: doc.serie ?? "1",
    numeroDps: numero,
    codigoMunicipioIbge: unitFiscal.end_municipio_ibge,
    prestador: { cnpj: unitFiscal.cnpj, inscricaoMunicipal: unitFiscal.inscricao_municipal },
    tomador: { cpf: guardian.cpf, nome: guardian.full_name ?? "Responsável" },
    codigoTribNacional: unitFiscal.nfse_item_lista_servico,
    codigoTribMunicipal: unitFiscal.nfse_codigo_tributacao_municipio,
    descricaoServico: `Sessão de recreação e brincar em playground infantil${session.child_name_snapshot ? ` — ${session.child_name_snapshot}` : ""} (pedido ${order.orderCode}).`,
    enderecoEvento: {
      cep: unitFiscal.end_cep,
      logradouro: unitFiscal.end_logradouro,
      numero: unitFiscal.end_numero,
      complemento: unitFiscal.end_complemento,
      bairro: unitFiscal.end_bairro,
    },
    valorServico: doc.totalCents / 100,
  };

  const { xml, idDps } = montarXmlDps(dpsInput);
  const xmlAssinado = assinarXmlDps({ xml, idDps, certPem, privateKeyPem });

  const resultado = await transmitirDps({ xmlAssinado, ambiente: doc.environment, certPem, privateKeyPem });
  const nowMs = Date.now();

  if (!resultado.autorizado) {
    onLog?.(`[fiscal] NFS-e ${doc.id} rejeitada pelo ADN (HTTP ${resultado.httpStatus}): ${resultado.mensagemErro}`);
    await supabase
      .from("fa_kiosk_fiscal_docs")
      .update({
        status: "REJEITADO",
        reject_message: resultado.mensagemErro,
        last_error: resultado.mensagemErro,
        rps_numero: numero,
        numero,
        updated_at_ms: nowMs,
      })
      .eq("id", doc.id);
    return;
  }

  const nNFSeMatch = resultado.nfseXml?.match(/<nNFSe>(\d+)<\/nNFSe>/);
  await supabase
    .from("fa_kiosk_fiscal_docs")
    .update({
      status: "AUTORIZADO",
      rps_numero: numero,
      numero,
      nfse_numero: nNFSeMatch?.[1] ?? resultado.chaveAcesso ?? String(numero),
      access_key: resultado.chaveAcesso,
      protocol_number: resultado.chaveAcesso,
      authorized_at_ms: nowMs,
      updated_at_ms: nowMs,
    })
    .eq("id", doc.id);
  onLog?.(`[fiscal] NFS-e ${doc.id} (venda ${order.orderCode}) autorizada pelo ADN — chave ${resultado.chaveAcesso}.`);
}
