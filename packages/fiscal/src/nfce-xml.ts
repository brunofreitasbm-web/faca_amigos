import { create } from "xmlbuilder2";
import { montarChaveAcesso } from "./chave-acesso.js";
import { anoMesLocal, formatarDataHoraFiscal } from "./data-hora.js";
import { montarUrlQrCodeNfce } from "./qrcode-nfce.js";
import { sanitizarTextoNfe } from "./texto.js";
import { tpAmbFromAmbiente, type DocumentoFiscalInput, type FormaPagamento } from "./types.js";

/**
 * Monta o XML da NFC-e (modelo 65), grupos `ide`/`emit`/`dest`/`det`/`total`/
 * `transp`/`pag`, conforme o layout nacional (NF-e/NFC-e, XSD público em
 * nfe.fazenda.gov.br). Cobre o caso comum do FaçaAmigos — Simples Nacional,
 * venda à vista, sem frete, ICMS por CSOSN — e separa PIS/COFINS em
 * NT/Alíquota/Outr conforme o CST de cada item (grupoPis/grupoCofins),
 * em vez de assumir "outras operações" (CST 49) para tudo.
 *
 * IMPORTANTE: este XML ainda não está assinado (ver assinatura.ts) e sua
 * conformidade byte a byte com o XSD oficial só é confirmada na Fase 5
 * (homologação), quando o manual e os arquivos de referência do Pará/SVRS
 * estiverem em mãos. Trate como "primeira aproximação testável", não como
 * verdade absoluta do layout.
 *
 * Pontos adicionais cobertos aqui: `dhEmi`/AAMM da chave usam o dia/mês
 * LOCAL (fuso `input.timeZone`, padrão America/Belem — ver data-hora.ts),
 * não UTC; `cNF` (código numérico) é validado contra `nNF` (número do
 * documento) para não deixar os dois campos coincidirem por acidente;
 * campos de texto livre passam por `sanitizarTextoNfe` (faixa ISO-8859-1);
 * em homologação, os textos fixos exigidos pelo MOC substituem a descrição
 * do primeiro item e o nome do destinatário; e, quando `input.qrCode` é
 * informado, o grupo opcional `infNFeSupl` (QR Code) é anexado depois de
 * `infNFe`.
 */

const XMLNS_NFE = "http://www.portalfiscal.inf.br/nfe";
const VERSAO_LEIAUTE = "4.00";

/** Código `tPag` do MOC — confirmar contra a tabela vigente na Fase 5. */
const TPAG_POR_METODO: Record<FormaPagamento, string> = {
  DINHEIRO: "01",
  CREDITO: "03",
  DEBITO: "04",
  VOUCHER: "05",
  PIX: "17",
};

function money(value: number): string {
  return value.toFixed(2);
}

function qty(value: number): string {
  return value.toFixed(4);
}

export interface MontarXmlNfceResult {
  xml: string;
  chaveAcesso: string;
  /** URL completa do QR Code (ver qrcode-nfce.ts) — null quando `input.qrCode` não foi informado. */
  qrCodeUrl: string | null;
}

/** CST de PIS/COFINS que indicam operação não tributada (NT) — sem base/alíquota/valor. */
const CST_PIS_COFINS_NAO_TRIBUTADO = ["04", "05", "06", "07", "08", "09"];
/** CST de PIS/COFINS tributado por alíquota (grupo "Aliq"). */
const CST_PIS_COFINS_ALIQUOTA = ["01", "02"];

function grupoPis(cst: string) {
  if (CST_PIS_COFINS_NAO_TRIBUTADO.includes(cst)) return { PISNT: { CST: cst } };
  if (CST_PIS_COFINS_ALIQUOTA.includes(cst)) {
    return { PISAliq: { CST: cst, vBC: money(0), pPIS: money(0), vPIS: money(0) } };
  }
  return { PISOutr: { CST: cst, vBC: money(0), pPIS: money(0), vPIS: money(0) } };
}

function grupoCofins(cst: string) {
  if (CST_PIS_COFINS_NAO_TRIBUTADO.includes(cst)) return { COFINSNT: { CST: cst } };
  if (CST_PIS_COFINS_ALIQUOTA.includes(cst)) {
    return { COFINSAliq: { CST: cst, vBC: money(0), pCOFINS: money(0), vCOFINS: money(0) } };
  }
  return { COFINSOutr: { CST: cst, vBC: money(0), pCOFINS: money(0), vCOFINS: money(0) } };
}

/** Textos fixos exigidos pelo MOC quando o documento é emitido em homologação. */
const TEXTO_HOMOLOGACAO_PROD = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
const TEXTO_HOMOLOGACAO_DEST = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

export function montarXmlNfce(input: DocumentoFiscalInput): MontarXmlNfceResult {
  const emissao = new Date(input.dataHoraEmissao);
  if (Number.isNaN(emissao.getTime())) {
    throw new Error(`dataHoraEmissao inválida: "${input.dataHoraEmissao}"`);
  }

  const tz = input.timeZone ?? "America/Belem";
  const { ano, mes } = anoMesLocal(emissao, tz);

  const chaveAcesso = montarChaveAcesso({
    emissaoAno: ano,
    emissaoMes: mes,
    cnpj: input.emitente.cnpj,
    serie: input.serie,
    numero: input.numero,
    tipoEmissao: input.tipoEmissao,
    codigoNumerico: input.codigoNumerico,
  });
  const cDV = chaveAcesso.slice(-1);
  const cNF = chaveAcesso.slice(35, 43);

  // cNF é um código numérico ALEATÓRIO — se coincidir com o próprio número
  // do documento (nNF), não é aleatório de verdade, é sinal de bug no
  // gerador (ex.: usar o mesmo contador para os dois campos por engano).
  if (cNF === String(input.numero).padStart(8, "0")) {
    throw new Error("codigoNumerico (cNF) não pode ser igual ao número da nota (nNF)");
  }

  const tpAmb = tpAmbFromAmbiente(input.ambiente);

  const vProd = input.itens.reduce((sum, item) => sum + item.valorTotal, 0);
  const vPag = input.pagamentos.reduce((sum, p) => sum + p.valor, 0);

  const det = input.itens.map((item, index) => ({
    "@nItem": String(index + 1),
    prod: {
      cProd: item.gtin === "SEM GTIN" ? String(index + 1) : item.gtin,
      cEAN: item.gtin,
      xProd: sanitizarTextoNfe(item.descricao, 120),
      NCM: item.ncm,
      ...(item.cest ? { CEST: item.cest } : {}),
      CFOP: item.cfop,
      uCom: item.unidadeComercial,
      qCom: qty(item.quantidade),
      vUnCom: money(item.valorUnitario),
      vProd: money(item.valorTotal),
      cEANTrib: item.gtin,
      uTrib: item.unidadeComercial,
      qTrib: qty(item.quantidade),
      vUnTrib: money(item.valorUnitario),
      indTot: "1",
    },
    imposto: {
      ICMS: {
        // ICMSSN102: Simples Nacional, sem permissão de crédito (CSOSN
        // 102/103/300/400). Se o contador confirmar outro CSOSN na Fase 0,
        // este mapeamento precisa ganhar os grupos correspondentes.
        ICMSSN102: {
          orig: String(item.origem),
          CSOSN: item.csosn,
        },
      },
      PIS: grupoPis(item.pisCst),
      COFINS: grupoCofins(item.cofinsCst),
    },
  }));

  // MOC (Nota Técnica sobre ambiente de homologação): o primeiro item da
  // nota e o nome do destinatário precisam trazer o aviso fixo de "sem
  // valor fiscal" quando emitida em homologação — texto obrigatório, não
  // sanitizado (é o próprio texto oficial, já em ASCII).
  if (input.ambiente === "HOMOLOGACAO" && det.length > 0) {
    det[0]!.prod.xProd = TEXTO_HOMOLOGACAO_PROD;
  }

  const detPag = input.pagamentos.map((p) => ({
    indPag: "0",
    tPag: TPAG_POR_METODO[p.metodo],
    vPag: money(p.valor),
  }));

  const infNFe: Record<string, unknown> = {
    "@versao": VERSAO_LEIAUTE,
    "@Id": `NFe${chaveAcesso}`,
    ide: {
      cUF: "15",
      cNF,
      natOp: "Venda de mercadoria",
      mod: "65",
      serie: String(input.serie),
      nNF: String(input.numero),
      dhEmi: formatarDataHoraFiscal(emissao, tz),
      tpNF: "1",
      idDest: "1",
      cMunFG: input.emitente.endMunicipioIbge,
      tpImp: "4",
      tpEmis: String(input.tipoEmissao),
      cDV,
      tpAmb,
      finNFe: "1",
      indFinal: "1",
      indPres: "1",
      procEmi: "0",
      verProc: "facaamigos-1.0",
      ...(input.contingencia
        ? { dhCont: input.contingencia.dataHoraEntrada, xJust: input.contingencia.justificativa }
        : {}),
    },
    emit: {
      CNPJ: input.emitente.cnpj.replace(/\D/g, ""),
      xNome: sanitizarTextoNfe(input.emitente.razaoSocial, 60),
      ...(input.emitente.nomeFantasia ? { xFant: sanitizarTextoNfe(input.emitente.nomeFantasia, 60) } : {}),
      enderEmit: {
        xLgr: sanitizarTextoNfe(input.emitente.endLogradouro, 60),
        nro: input.emitente.endNumero,
        ...(input.emitente.endComplemento ? { xCpl: input.emitente.endComplemento } : {}),
        xBairro: sanitizarTextoNfe(input.emitente.endBairro, 60),
        cMun: input.emitente.endMunicipioIbge,
        xMun: sanitizarTextoNfe(input.emitente.endMunicipioNome, 60),
        UF: input.emitente.endUf,
        CEP: input.emitente.endCep.replace(/\D/g, ""),
        cPais: "1058",
        xPais: "BRASIL",
        ...(input.emitente.fone ? { fone: input.emitente.fone.replace(/\D/g, "") } : {}),
      },
      IE: input.emitente.inscricaoEstadual.replace(/\D/g, ""),
      CRT: String(input.emitente.crt),
    },
    ...(input.destinatario?.cpf
      ? {
          dest: {
            CPF: input.destinatario.cpf,
            // Em homologação, o MOC exige o texto fixo de aviso no lugar
            // do nome real do consumidor, mesmo quando o nome foi informado.
            ...(input.ambiente === "HOMOLOGACAO"
              ? { xNome: TEXTO_HOMOLOGACAO_DEST }
              : input.destinatario.nome
                ? { xNome: sanitizarTextoNfe(input.destinatario.nome, 60) }
                : {}),
            // "9" = não contribuinte — correto para destinatário identificado só por CPF.
            indIEDest: "9",
          },
        }
      : {}),
    det,
    total: {
      ICMSTot: {
        vBC: money(0),
        vICMS: money(0),
        vICMSDeson: money(0),
        vFCP: money(0),
        vBCST: money(0),
        vST: money(0),
        vFCPST: money(0),
        vFCPSTRet: money(0),
        vProd: money(vProd),
        vFrete: money(0),
        vSeg: money(0),
        vDesc: money(0),
        vII: money(0),
        vIPI: money(0),
        vIPIDevol: money(0),
        vPIS: money(0),
        vCOFINS: money(0),
        vOutro: money(0),
        vNF: money(vProd),
      },
    },
    transp: { modFrete: "9" },
    pag: {
      detPag,
      vTroco: money(Math.max(0, vPag - vProd)),
    },
  };

  // QR Code (infNFeSupl) é opcional — só entra quando o chamador já tem o
  // CSC do cofre local em mãos (worker Electron, Fase 5). O valor de texto
  // livre (string direta como valor da chave) segue a mesma convenção já
  // usada acima para xNome/xLgr etc. — o xmlbuilder2, no modo de conversão
  // de objeto, trata isso como o texto do elemento.
  const qrCodeUrl = input.qrCode
    ? montarUrlQrCodeNfce({
        chaveAcesso,
        tpAmb,
        idCsc: input.qrCode.idCsc,
        cscToken: input.qrCode.cscToken,
        urlConsulta: input.qrCode.urlConsulta,
      })
    : null;

  // Documento inteiro como um único objeto passado a `create(...)` — o modo
  // de conversão que o xmlbuilder2 documenta como estável: chaves "@..."
  // viram atributos, objetos aninhados viram elementos filhos, arrays viram
  // elementos irmãos repetidos (usado em `det` e `detPag` acima). A ordem
  // das chaves do objeto raiz decide a ordem dos elementos no XML, por isso
  // `infNFeSupl` vem depois de `infNFe` — sequência exigida pelo layout
  // 4.00 (infNFe → infNFeSupl opcional → Signature, ver assinatura.ts).
  const doc = {
    NFe: {
      "@xmlns": XMLNS_NFE,
      infNFe,
      ...(input.qrCode && qrCodeUrl
        ? { infNFeSupl: { qrCode: qrCodeUrl, urlChave: input.qrCode.urlChave } }
        : {}),
    },
  };

  const xml = create({ version: "1.0", encoding: "UTF-8" }, doc).end({
    prettyPrint: false,
    headless: false,
  });

  return { xml, chaveAcesso, qrCodeUrl };
}
