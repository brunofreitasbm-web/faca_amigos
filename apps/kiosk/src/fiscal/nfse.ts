import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { anoMesLocal, assinarXmlDps, montarXmlDps, type DpsInput } from "@facaamigos/fiscal";
import {
  CODIGO_ERRO_DPS_JA_PROCESSADA,
  consultarChaveAcessoPorDps,
  consultarNfsePorChave,
  transmitirDps,
} from "@facaamigos/fiscal/dps-nacional-transport";
import { buscarCredenciaisFiscais } from "./certificado.js";
import { extrairChaveECertificadoPem } from "./vault.js";
import type { ClaimDeps, ClaimedFiscalDoc } from "./claim.js";

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

export async function processarNfseSimulado(supabase: SupabaseClient, item: ClaimedFiscalDoc, originDeviceId: string | null = null): Promise<void> {
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

  try {
    await supabase.from("fa_kiosk_print_jobs").insert({
      unit_id: unit.id,
      kind: "RECEIPT",
      origin_device_id: originDeviceId,
      payload_json: {
        title: "COMPROVANTE NFS-e (SIMULADO)",
        unitName: unit.cnpj ? `CNPJ: ${unit.cnpj}` : "FAÇA AMIGOS",
        code: item.order.orderCode,
        dateTime: new Date(nowMs).toLocaleString("pt-BR"),
        items: (item.items as Array<Record<string, unknown>>).map((it) => ({
          description: String(it.description ?? it.name ?? "Serviço de Recreação"),
          quantity: Number(it.quantity ?? 1),
          amountCents: Number(it.totalCents ?? 0),
        })),
        totalCents: doc.totalCents,
        payments: (item.payments as Array<Record<string, unknown>>).map((p) => ({
          method: String(p.method ?? "PIX"),
          amountCents: Number(p.amountCents ?? doc.totalCents),
        })),
        footerNote: `NFS-e (RPS nº ${numero})\nProt: SIMULADO-${doc.id.slice(0, 8)}`,
      },
    });
  } catch (errPrint) {
    // Silencioso em caso de falha de enfileiramento de impressão
  }
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
  timezone: string | null;
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
export async function processarNfseReal(deps: ClaimDeps, item: ClaimedFiscalDoc): Promise<void> {
  const { supabase, onLog, deviceId } = deps;
  const originDeviceId = deviceId ?? null;
  const { doc, order, unit } = item;

  const { data: unitFiscal, error: unitError } = await supabase
    .from("fa_kiosk_units")
    .select(
      "cnpj, inscricao_municipal, nfse_item_lista_servico, nfse_codigo_tributacao_municipio, " +
        "end_cep, end_logradouro, end_numero, end_complemento, end_bairro, end_municipio_ibge, timezone",
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
    const nameStr = guardian?.full_name ? `'${guardian.full_name}' ` : "";
    await bloquear(supabase, doc.id, `Responsável ${nameStr}sem CPF cadastrado — obrigatório como tomador da DPS.`);
    return;
  }

  const cred = await buscarCredenciaisFiscais(
    supabase,
    unit.id,
    deps.userDataPath && deps.crypto ? { userDataPath: deps.userDataPath, crypto: deps.crypto } : undefined,
  );
  if (!cred.ok) {
    await bloquear(supabase, doc.id, cred.motivo);
    return;
  }

  let certPem: string;
  let privateKeyPem: string;
  try {
    ({ certPem, privateKeyPem } = extrairChaveECertificadoPem(cred.credenciais.pfxBuffer, cred.credenciais.password));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await bloquear(supabase, doc.id, `Não foi possível abrir o certificado A1: ${message}`);
    return;
  }

  // Reaproveita o número já reservado numa tentativa anterior deste MESMO
  // documento em vez de sortear um novo — reservarNumeroRps nunca reserva o
  // mesmo número duas vezes (fa_fiscal_reserve_number é um contador puro,
  // sem noção de "documento"), então sortear de novo a cada retry arrisca
  // gerar uma SEGUNDA NFS-e real para a mesma venda sempre que uma
  // transmissão anterior tiver sido aceita pelo ADN mas a resposta se
  // perdeu antes de chegar aqui (foi exatamente o que aconteceu com o RPS
  // nº7 da unidade Circuito em 2026-09-02 — ver CODIGO_ERRO_DPS_JA_PROCESSADA
  // acima, que existe como rede de segurança para quando isso já tiver
  // ocorrido antes desta correção).
  const numero = doc.numero ?? (await reservarNumeroRps(supabase, doc, unit.id));
  const agora = new Date();
  const timeZone = unitFiscal.timezone ?? undefined;

  const dpsInput: DpsInput = {
    ambiente: doc.environment,
    dataHoraEmissao: agora,
    dataCompetencia: agora,
    serieDps: doc.serie ?? "1",
    numeroDps: numero,
    codigoMunicipioIbge: unitFiscal.end_municipio_ibge,
    // IM não é enviada: a Faça Amigos não tem registro complementar no CNC
    // de Belém (confirmado 2026-08-19), e a RN #122 do Anexo I só permite
    // IM quando esse registro existe.
    prestador: { cnpj: unitFiscal.cnpj },
    tomador: { cpf: guardian.cpf, nome: guardian.full_name ?? "Responsável" },
    codigoTribNacional: unitFiscal.nfse_item_lista_servico,
    codigoTribMunicipal: unitFiscal.nfse_codigo_tributacao_municipio,
    descricaoServico: `Sessão de recreação e brincar em playground infantil${session.child_name_snapshot ? ` - ${session.child_name_snapshot}` : ""} (pedido ${order.orderCode}).`,
    enderecoEvento: {
      cep: unitFiscal.end_cep,
      logradouro: unitFiscal.end_logradouro,
      numero: unitFiscal.end_numero,
      complemento: unitFiscal.end_complemento,
      bairro: unitFiscal.end_bairro,
    },
    valorServico: doc.totalCents / 100,
    timeZone,
  };

  const { xml, idDps } = montarXmlDps(dpsInput);
  const xmlAssinado = assinarXmlDps({ xml, idDps, certPem, privateKeyPem });

  let resultado = await transmitirDps({ xmlAssinado, ambiente: doc.environment, certPem, privateKeyPem });
  const nowMs = Date.now();

  // E0014 = a série/número/município/CNPJ desta DPS já geraram uma NFS-e
  // numa transmissão anterior (ex.: a resposta se perdeu por timeout/queda
  // de rede depois que o ADN já tinha processado). `numero` é reservado de
  // forma idempotente por doc.id (reservarNumeroRps), então reenviar com
  // outro número criaria uma segunda NFS-e para a mesma venda — o correto é
  // buscar a que já existe, não gerar outra.
  if (!resultado.autorizado && resultado.codigosErro.includes(CODIGO_ERRO_DPS_JA_PROCESSADA)) {
    onLog?.(`[fiscal] NFS-e ${doc.id}: DPS já processada (E0014) — recuperando a NFS-e já emitida em vez de reenviar.`);
    const { chaveAcesso } = await consultarChaveAcessoPorDps({ idDps, ambiente: doc.environment, certPem, privateKeyPem });
    if (chaveAcesso) {
      const { nfseXml } = await consultarNfsePorChave({ chaveAcesso, ambiente: doc.environment, certPem, privateKeyPem });
      if (nfseXml) {
        resultado = { autorizado: true, httpStatus: 200, tipoAmbiente: null, chaveAcesso, nfseXml, mensagemErro: null, codigosErro: [], alertas: [] };
      }
    }
    if (!resultado.autorizado) {
      onLog?.(`[fiscal] NFS-e ${doc.id}: não foi possível recuperar a NFS-e já emitida (E0014) — chave/XML indisponíveis na consulta ao ADN.`);
    }
  }

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
    try {
      await supabase.from("fa_kiosk_fiscal_doc_events").insert({
        fiscal_doc_id: doc.id,
        kind: "NFSE_TRANSMISSAO",
        http_status: resultado.httpStatus,
        detail_json: { autorizado: false, mensagemErro: resultado.mensagemErro },
      });
    } catch (errEvent) {
      onLog?.(`[fiscal] Erro ao gravar evento NFSE_TRANSMISSAO (rejeição) para ${doc.id}: ${errEvent}`);
    }
    return;
  }

  const nNFSeMatch = resultado.nfseXml?.match(/<nNFSe>(\d+)<\/nNFSe>/);
  const nfseNum = nNFSeMatch?.[1] ?? resultado.chaveAcesso ?? String(numero);

  const updatePayload: Record<string, unknown> = {
    status: "AUTORIZADO",
    rps_numero: numero,
    numero,
    nfse_numero: nfseNum,
    access_key: resultado.chaveAcesso,
    protocol_number: resultado.chaveAcesso,
    authorized_at_ms: nowMs,
    updated_at_ms: nowMs,
  };

  if (resultado.nfseXml) {
    try {
      const { ano, mes } = anoMesLocal(agora, timeZone);
      const path = `${unit.id}/nfse/${ano}/${mes}/${nfseNum}.xml`;
      const xmlBuffer = Buffer.from(resultado.nfseXml, "utf-8");
      const { error: uploadError } = await supabase.storage
        .from("fiscal-xml")
        .upload(path, xmlBuffer, { contentType: "application/xml", upsert: true });
      if (uploadError) {
        onLog?.(`[fiscal] Erro ao subir XML da NFS-e ${doc.id} para o Storage: ${uploadError.message}`);
      } else {
        updatePayload.xml_storage_path = path;
        updatePayload.xml_sha256 = createHash("sha256").update(xmlBuffer).digest("hex");
      }
    } catch (errUpload) {
      onLog?.(`[fiscal] Erro ao processar/subir XML da NFS-e ${doc.id}: ${errUpload}`);
    }
  }

  await supabase.from("fa_kiosk_fiscal_docs").update(updatePayload).eq("id", doc.id);

  try {
    await supabase.from("fa_kiosk_fiscal_doc_events").insert({
      fiscal_doc_id: doc.id,
      kind: "NFSE_TRANSMISSAO",
      http_status: resultado.httpStatus,
      detail_json: { autorizado: true, chaveAcesso: resultado.chaveAcesso, alertas: resultado.alertas },
    });
  } catch (errEvent) {
    onLog?.(`[fiscal] Erro ao gravar evento NFSE_TRANSMISSAO (autorização) para ${doc.id}: ${errEvent}`);
  }

  try {
    await supabase.from("fa_kiosk_print_jobs").insert({
      unit_id: unit.id,
      kind: "RECEIPT",
      origin_device_id: originDeviceId,
      payload_json: {
        title: "COMPROVANTE NFS-e NACIONAL",
        unitName: unitFiscal.cnpj ? `CNPJ: ${unitFiscal.cnpj}` : "FAÇA AMIGOS",
        code: order.orderCode,
        dateTime: new Date(nowMs).toLocaleString("pt-BR"),
        items: (item.items as Array<Record<string, unknown>>).map((it) => ({
          description: String(it.description ?? it.name ?? "Serviço de Recreação"),
          quantity: Number(it.quantity ?? 1),
          amountCents: Number(it.totalCents ?? 0),
        })),
        totalCents: doc.totalCents,
        payments: (item.payments as Array<Record<string, unknown>>).map((p) => ({
          method: String(p.method ?? "PIX"),
          amountCents: Number(p.amountCents ?? doc.totalCents),
        })),
        footerNote: `NFS-e nº ${nfseNum}\nChave: ${resultado.chaveAcesso ?? ""}`,
      },
    });
  } catch (errPrint) {
    onLog?.(`[fiscal] Erro ao enfileirar impressão da NFS-e para ${doc.id}: ${errPrint}`);
  }
  onLog?.(`[fiscal] NFS-e ${doc.id} (venda ${order.orderCode}) autorizada pelo ADN — chave ${resultado.chaveAcesso}.`);
}
