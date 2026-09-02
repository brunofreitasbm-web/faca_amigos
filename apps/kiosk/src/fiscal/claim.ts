import type { SupabaseClient } from "@supabase/supabase-js";
import { randomInt, createHash } from "node:crypto";
import {
  anoMesLocal,
  assinarXmlNfce,
  gerarChaveAcessoNfceOuFallback,
  montarXmlNfce,
  URLS_NFCE_PA,
  type DocumentoFiscalInput,
  type FormaPagamento,
} from "@facaamigos/fiscal";
// Fora do barrel principal (`@facaamigos/fiscal`) de propósito — usa
// `node:https`, e o kiosk-ui (bundle de navegador) importa esse pacote.
import { SvrsNfceTransport } from "@facaamigos/fiscal/svrs-transport";
import { buscarCredenciaisFiscais } from "./certificado.js";
import { processarNfseReal, processarNfseSimulado } from "./nfse.js";
import { extrairChaveECertificadoPem, type CofreCrypto } from "./vault.js";

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
    rpsSerie: string | null;
    numero: number | null;
    accessKey: string | null;
    qrcodeUrl: string | null;
    attempts: number;
    totalCents: number;
  };
  order: {
    id: string;
    orderCode: string;
    businessDate: string;
    closedAtMs: number | null;
    fiscalCpf: string | null;
    fiscalNome: string | null;
    fiscalEmail: string | null;
  };
  unit: {
    id: string;
    cnpj: string | null;
    razaoSocial: string | null;
    nomeFantasia: string | null;
    inscricaoEstadual: string | null;
    crt: number | null;
    endLogradouro: string | null;
    endNumero: string | null;
    endComplemento: string | null;
    endBairro: string | null;
    endMunicipioIbge: string | null;
    endMunicipioNome: string | null;
    endUf: string | null;
    endCep: string | null;
    fone: string | null;
    timezone: string | null;
    nfceSerie: number | null;
    fiscalAmbiente: string | null;
    nfceCscId: string | null;
    nfceQrcodeUrlConsulta: string | null;
  };
  items: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    productId: string | null;
    ncm: string | null;
    cest: string | null;
    cfop: string | null;
    csosn: string | null;
    origem: number | null;
    unidadeComercial: string | null;
    gtin: string | null;
    pisCst: string | null;
    cofinsCst: string | null;
    fiscalReady: boolean | null;
  }>;
  payments: Array<{ method: string; amountCents: number }>;
}

export interface ClaimDeps {
  supabase: SupabaseClient;
  terminalId: string;
  /**
   * device_id DESTE computador (terminal_settings), diferente do
   * terminalId do worker fiscal. Vai como origin_device_id no cupom
   * enfileirado para o print bridge dar preferência de impressão à
   * máquina que emitiu a nota, em vez de esperar a carência.
   */
  deviceId?: string | null;
  simulado: boolean;
  userDataPath?: string;
  crypto?: CofreCrypto;
  onLog?: (message: string) => void;
}

async function bloquear(supabase: SupabaseClient, docId: string, motivo: string): Promise<void> {
  await supabase
    .from("fa_kiosk_fiscal_docs")
    .update({ status: "BLOQUEADO", last_error: motivo, updated_at_ms: Date.now() })
    .eq("id", docId);
}

/**
 * Faz a NFC-e completa: valida cadastro/itens, garante credenciais e
 * numeração, monta+assina+transmite o XML à SVRS e registra o resultado.
 * Cada etapa que não pode prosseguir sem intervenção humana (cadastro
 * incompleto, produto sem tributação, certificado indisponível, CSC
 * ausente, forma de pagamento sem mapeamento fiscal) bloqueia o documento
 * com um motivo específico em vez de deixar a exceção genérica confundir
 * quem for investigar depois.
 */
export async function processarNfceReal(deps: ClaimDeps, item: ClaimedFiscalDoc): Promise<void> {
  const { supabase } = deps;
  const nowMs = Date.now();
  const { doc, order, unit } = item;

  // a. Validação de cadastro do emitente
  const camposObrigatorios: Array<[string, string | null]> = [
    ["CNPJ", unit.cnpj],
    ["Razão Social", unit.razaoSocial],
    ["Inscrição Estadual", unit.inscricaoEstadual],
    ["Logradouro", unit.endLogradouro],
    ["Número", unit.endNumero],
    ["Bairro", unit.endBairro],
    ["Código IBGE do Município", unit.endMunicipioIbge],
    ["Nome do Município", unit.endMunicipioNome],
    ["CEP", unit.endCep],
  ];
  const faltando = camposObrigatorios.filter(([, valor]) => !valor).map(([label]) => label);
  if (faltando.length > 0) {
    await bloquear(supabase, doc.id, `Emitente incompleto em Configurações → Fiscal: preencha ${faltando.join(", ")}.`);
    return;
  }

  // b. Validação dos itens fiscais
  if (item.items.length === 0) {
    await supabase.from("fa_kiosk_fiscal_docs").update({ status: "DESCARTADO", updated_at_ms: nowMs }).eq("id", doc.id);
    return;
  }
  const itensSemTributacao = item.items.filter((it) => !it.fiscalReady || !it.ncm);
  if (itensSemTributacao.length > 0) {
    const nomes = itensSemTributacao.map((it) => it.description).join(", ");
    await bloquear(
      supabase,
      doc.id,
      `Produto(s) sem tributação completa: ${nomes}. Preencha NCM/CFOP/CSOSN em Configurações → Fiscal → Tributação por produto e clique em Tentar Novamente.`,
    );
    return;
  }

  // VOUCHER ainda não tem tPag definido — bloqueia antes de gastar
  // numeração/certificado com um documento que não pode ser transmitido.
  if (item.payments.some((p) => p.method === "VOUCHER")) {
    await bloquear(
      supabase,
      doc.id,
      "Forma de pagamento 'Voucher' ainda não tem mapeamento fiscal definido — confirme com o contador o tPag correto antes de emitir esta NFC-e.",
    );
    return;
  }

  // c. Credenciais (certificado A1 + CSC)
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
    const msg = err instanceof Error ? err.message : String(err);
    await bloquear(supabase, doc.id, `Falha ao extrair chave privada do certificado A1: ${msg}`);
    return;
  }

  if (!cred.credenciais.cscToken) {
    await bloquear(supabase, doc.id, "Token do CSC não configurado (Configurações → Fiscal → NFC-e → Salvar CSC).");
    return;
  }
  // O cofre local não guarda o id do CSC — cai para o já cadastrado na unidade.
  const cscId = cred.credenciais.cscId ?? unit.nfceCscId;

  const transport = new SvrsNfceTransport({ certPem, privateKeyPem });

  // d. Numeração — reserva um número novo só quando o documento ainda não tem
  // um (retentativas reaproveitam o número/cNF já usado na tentativa anterior).
  const serie = doc.serie ?? String(unit.nfceSerie ?? 1);
  let numero = doc.numero;
  let codigoNumerico: string;

  if (doc.accessKey) {
    // Retentativa de um documento que já chegou a montar uma chave de
    // acesso antes — reaproveita número e cNF para a chave sair idêntica.
    numero = doc.numero;
    codigoNumerico = doc.accessKey.slice(35, 43);
  } else {
    if (numero == null) {
      const { data: reservado, error: reserveError } = await supabase.rpc("fa_fiscal_reserve_number", {
        p_unit_id: unit.id,
        p_doc_type: "NFCE",
        p_environment: doc.environment,
        p_serie: serie,
      });
      if (reserveError) {
        await bloquear(supabase, doc.id, `Falha ao reservar numeração da NFC-e: ${reserveError.message}`);
        return;
      }
      numero = reservado as number;
    }
    codigoNumerico = randomInt(0, 1e8).toString().padStart(8, "0");
    // cNF aleatório não pode coincidir com nNF — montarXmlNfce lançaria erro
    // de validação; regenera uma vez para evitar isso na prática.
    if (codigoNumerico === String(numero).padStart(8, "0")) {
      codigoNumerico = randomInt(0, 1e8).toString().padStart(8, "0");
    }
  }

  if (numero == null) {
    await bloquear(supabase, doc.id, "Não foi possível determinar o número da NFC-e.");
    return;
  }

  // e. Idempotência: se este documento já tem chave de acesso, pode já ter
  // sido enviado numa tentativa anterior que morreu antes de gravar o
  // resultado — consulta por chave antes de gerar/transmitir de novo.
  let resultado: Awaited<ReturnType<SvrsNfceTransport["autorizar"]>> | undefined;
  let chaveAcesso: string | undefined;
  let qrCodeUrl: string | null | undefined;

  let resolvidoPorConsulta = false;
  if (doc.accessKey) {
    try {
      const consulta = await transport.consultarPorChave(doc.accessKey, doc.environment);
      if (consulta.autorizado) {
        resultado = consulta;
        chaveAcesso = doc.accessKey;
        qrCodeUrl = doc.qrcodeUrl ?? null;
        resolvidoPorConsulta = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await bloquear(supabase, doc.id, `Falha de comunicação com a SVRS: ${msg}`);
      return;
    }
  }

  if (!resolvidoPorConsulta) {
    // f. Montar XML
    const inputFiscal: DocumentoFiscalInput = {
      ambiente: doc.environment,
      serie: Number(serie),
      numero,
      codigoNumerico,
      tipoEmissao: doc.emissionType === "CONTINGENCIA_OFFLINE" ? 9 : 1,
      dataHoraEmissao: new Date().toISOString(),
      contingencia: null,
      timeZone: unit.timezone ?? undefined,
      emitente: {
        cnpj: unit.cnpj!,
        razaoSocial: unit.razaoSocial!,
        nomeFantasia: unit.nomeFantasia ?? null,
        inscricaoEstadual: unit.inscricaoEstadual!,
        crt: unit.crt ?? 1,
        endLogradouro: unit.endLogradouro!,
        endNumero: unit.endNumero!,
        endComplemento: unit.endComplemento ?? null,
        endBairro: unit.endBairro!,
        endMunicipioIbge: unit.endMunicipioIbge!,
        endMunicipioNome: unit.endMunicipioNome!,
        endUf: unit.endUf ?? "PA",
        endCep: unit.endCep!,
        fone: unit.fone ?? null,
      },
      destinatario: order.fiscalCpf ? { cpf: order.fiscalCpf, nome: order.fiscalNome ?? null } : null,
      itens: item.items.map((it) => ({
        descricao: it.description,
        quantidade: it.quantity,
        valorUnitario: it.unitPriceCents / 100,
        valorTotal: it.totalCents / 100,
        ncm: it.ncm!,
        cest: it.cest ?? null,
        cfop: it.cfop!,
        csosn: it.csosn!,
        origem: it.origem ?? 0,
        unidadeComercial: it.unidadeComercial ?? "UN",
        gtin: it.gtin ?? "SEM GTIN",
        pisCst: it.pisCst ?? "49",
        cofinsCst: it.cofinsCst ?? "49",
      })),
      pagamentos: item.payments.map((p) => ({ metodo: (p.method as FormaPagamento) ?? "PIX", valor: p.amountCents / 100 })),
      qrCode: {
        idCsc: cscId!,
        cscToken: cred.credenciais.cscToken!,
        urlConsulta: unit.nfceQrcodeUrlConsulta || URLS_NFCE_PA[doc.environment].qrCode,
        urlChave: URLS_NFCE_PA[doc.environment].urlChave,
      },
    };

    let montado: ReturnType<typeof montarXmlNfce>;
    try {
      montado = montarXmlNfce(inputFiscal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await bloquear(supabase, doc.id, `Falha ao montar o XML da NFC-e: ${msg}`);
      return;
    }
    chaveAcesso = montado.chaveAcesso;
    qrCodeUrl = montado.qrCodeUrl;

    const xmlAssinado = assinarXmlNfce({ xml: montado.xml, chaveAcesso, privateKeyPem, certPem });

    // g. Persiste ANTES de transmitir — se der corrida com outro terminal
    // (unique index em access_key), aborta sem transmitir.
    const { error: persistError } = await supabase
      .from("fa_kiosk_fiscal_docs")
      .update({
        status: "ASSINADO",
        numero,
        serie,
        access_key: chaveAcesso,
        qrcode_url: qrCodeUrl,
        updated_at_ms: nowMs,
      })
      .eq("id", doc.id);
    if (persistError) {
      await bloquear(supabase, doc.id, `Falha ao gravar NFC-e assinada antes da transmissão: ${persistError.message}`);
      return;
    }

    // h. Transmite
    try {
      resultado = await transport.autorizar(xmlAssinado, doc.environment);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await bloquear(supabase, doc.id, `Falha de comunicação com a SVRS: ${msg}`);
      return;
    }
  }

  // Os dois blocos acima (e/f-h) são mutuamente exclusivos em runtime — um
  // deles sempre atribui `resultado`/`chaveAcesso` antes daqui, ou a função
  // já retornou num `return` cedo. O guarda abaixo só existe para o
  // compilador (e como rede de segurança contra um bug futuro que quebre
  // essa invariante).
  if (resultado === undefined || chaveAcesso === undefined) {
    await bloquear(supabase, doc.id, "Falha interna ao processar a NFC-e: nenhum resultado de autorização obtido.");
    return;
  }

  if (resultado.autorizado) {
    if (!resultado.protocolo) {
      await bloquear(supabase, doc.id, "SVRS autorizou sem devolver protocolo — investigar.");
      return;
    }

    deps.onLog?.(`[fiscal] NFC-e ${doc.id} autorizada na SVRS! Protocolo: ${resultado.protocolo}`);

    const updatePayload: Record<string, unknown> = {
      status: "AUTORIZADO",
      protocol_number: resultado.protocolo,
      authorized_at_ms: nowMs,
      updated_at_ms: nowMs,
      last_error: null,
    };

    if (resultado.xmlAutorizado) {
      try {
        const { ano, mes } = anoMesLocal(new Date(nowMs), unit.timezone ?? undefined);
        const path = `${unit.id}/nfce/${ano}/${mes}/${chaveAcesso}.xml`;
        const xmlBuffer = Buffer.from(resultado.xmlAutorizado, "utf-8");
        const { error: uploadError } = await supabase.storage
          .from("fiscal-xml")
          .upload(path, xmlBuffer, { contentType: "application/xml", upsert: true });
        if (uploadError) {
          deps.onLog?.(`[fiscal] Erro ao subir XML autorizado da NFC-e ${doc.id}: ${uploadError.message}`);
        } else {
          updatePayload.xml_storage_path = path;
          updatePayload.xml_sha256 = createHash("sha256").update(xmlBuffer).digest("hex");
        }
      } catch (errUpload) {
        deps.onLog?.(`[fiscal] Erro ao processar/subir XML autorizado da NFC-e ${doc.id}: ${errUpload}`);
      }
    }

    await supabase.from("fa_kiosk_fiscal_docs").update(updatePayload).eq("id", doc.id);

    try {
      await supabase.from("fa_kiosk_fiscal_doc_events").insert({
        fiscal_doc_id: doc.id,
        kind: "NFCE_AUTORIZACAO",
        cstat: resultado.cstat,
        xmotivo: resultado.xmotivo,
        detail_json: { protocolo: resultado.protocolo, chaveAcesso },
      });
    } catch (errEvent) {
      deps.onLog?.(`[fiscal] Erro ao gravar evento NFCE_AUTORIZACAO para ${doc.id}: ${errEvent}`);
    }

    try {
      await supabase.from("fa_kiosk_print_jobs").insert({
        unit_id: unit.id,
        kind: "RECEIPT",
        origin_device_id: deps.deviceId ?? null,
        payload_json: {
          title: "DANFE NFC-e",
          unitName: unit.nomeFantasia ?? unit.razaoSocial ?? "FAÇA AMIGOS",
          code: order.orderCode,
          dateTime: new Date(nowMs).toLocaleString("pt-BR"),
          items: item.items.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            amountCents: it.totalCents,
          })),
          totalCents: doc.totalCents,
          payments: item.payments.map((p) => ({ method: p.method, amountCents: p.amountCents })),
          fiscalQrUrl: qrCodeUrl ?? undefined,
          fiscalAccessKey: chaveAcesso,
          fiscalProtocol: resultado.protocolo,
          fiscalNumero: numero,
          fiscalSerie: serie,
          fiscalAmbiente: doc.environment,
        },
      });
    } catch (errPrint) {
      deps.onLog?.(`[fiscal] Erro ao enfileirar impressão do DANFE para ${doc.id}: ${errPrint}`);
    }
  } else {
    deps.onLog?.(`[fiscal] NFC-e ${doc.id} rejeitada na SVRS (cStat ${resultado.cstat}): ${resultado.xmotivo}`);
    await supabase
      .from("fa_kiosk_fiscal_docs")
      .update({
        status: "REJEITADO",
        reject_code: resultado.cstat,
        reject_message: resultado.xmotivo,
        last_error: resultado.xmotivo,
        updated_at_ms: nowMs,
      })
      .eq("id", doc.id);

    try {
      await supabase.from("fa_kiosk_fiscal_doc_events").insert({
        fiscal_doc_id: doc.id,
        kind: "NFCE_REJEICAO",
        cstat: resultado.cstat,
        xmotivo: resultado.xmotivo,
        detail_json: { chaveAcesso },
      });
    } catch (errEvent) {
      deps.onLog?.(`[fiscal] Erro ao gravar evento NFCE_REJEICAO para ${doc.id}: ${errEvent}`);
    }
  }
}

async function reservarNumeroNfceSimulado(supabase: SupabaseClient, doc: ClaimedFiscalDoc["doc"], unitId: string): Promise<number> {
  const { data, error } = await supabase.rpc("fa_fiscal_reserve_number", {
    p_unit_id: unitId,
    p_doc_type: "NFCE",
    p_environment: doc.environment,
    p_serie: doc.serie ?? "1",
  });
  if (error) throw new Error(`fa_fiscal_reserve_number (NFCE simulado) falhou: ${error.message}`);
  return data as number;
}

async function processarDocumentoSimulado(supabase: SupabaseClient, item: ClaimedFiscalDoc, originDeviceId: string | null = null): Promise<void> {
  const nowMs = Date.now();
  const doc = item.doc;
  // Simulado também não pode colidir número entre documentos — reserva um
  // número real na mesma numeração usada pelo caminho real quando o
  // documento ainda não tiver um.
  const numero = doc.numero ?? (await reservarNumeroNfceSimulado(supabase, doc, item.unit.id));
  const accessKey = doc.accessKey && doc.accessKey.length === 44 && !doc.accessKey.startsWith("000000")
    ? doc.accessKey
    : gerarChaveAcessoNfceOuFallback({
        emissaoData: nowMs,
        cnpj: item.unit.cnpj,
        serie: doc.serie,
        numero,
        seedId: doc.id,
      });

  const numericPart = doc.id.replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
  const protocolNumber = `15326${numericPart}`;

  await supabase
    .from("fa_kiosk_fiscal_docs")
    .update({
      status: "AUTORIZADO",
      access_key: accessKey,
      numero,
      serie: doc.serie ?? "1",
      protocol_number: protocolNumber,
      authorized_at_ms: nowMs,
      updated_at_ms: nowMs,
    })
    .eq("id", doc.id);

  try {
    await supabase.from("fa_kiosk_print_jobs").insert({
      unit_id: item.unit.id,
      kind: "RECEIPT",
      origin_device_id: originDeviceId,
      payload_json: {
        title: "DANFE NFC-e (SIMULADO)",
        unitName: item.unit.cnpj ? `CNPJ: ${item.unit.cnpj}` : "FAÇA AMIGOS",
        code: item.order.orderCode,
        dateTime: new Date(nowMs).toLocaleString("pt-BR"),
        items: (item.items as Array<Record<string, unknown>>).map((it) => ({
          description: String(it.description ?? "Item"),
          quantity: Number(it.quantity ?? 1),
          amountCents: Number(it.totalCents ?? 0),
        })),
        totalCents: doc.totalCents,
        payments: (item.payments as Array<Record<string, unknown>>).map((p) => ({
          method: String(p.method ?? "PIX"),
          amountCents: Number(p.amountCents ?? doc.totalCents),
        })),
        footerNote: `NFC-e nº ${numero} Série ${doc.serie ?? "1"}\nChave: ${accessKey}\nProt: ${protocolNumber}`,
      },
    });
  } catch (errPrint) {
    // Silencioso em ambiente simulado se print jobs falhar
  }
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
          await processarNfseSimulado(deps.supabase, item, deps.deviceId ?? null);
          deps.onLog?.(`[fiscal] NFS-e ${item.doc.id} (venda ${item.order.orderCode}) autorizada (SIMULADO).`);
        } else {
          await processarNfseReal(deps, item);
        }
      } else if (deps.simulado) {
        await processarDocumentoSimulado(deps.supabase, item, deps.deviceId ?? null);
        deps.onLog?.(`[fiscal] documento ${item.doc.id} (venda ${item.order.orderCode}) autorizado (SIMULADO).`);
      } else {
        await processarNfceReal(deps, item);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.onLog?.(`[fiscal] documento ${item.doc.id} falhou: ${message}`);
    }
  }
  return claimed.length;
}
