import { create } from "xmlbuilder2";
import { montarChaveAcesso } from "./chave-acesso.js";
import { tpAmbFromAmbiente, type DocumentoFiscalInput, type FormaPagamento } from "./types.js";

/**
 * Monta o XML da NFC-e (modelo 65), grupos `ide`/`emit`/`dest`/`det`/`total`/
 * `transp`/`pag`, conforme o layout nacional (NF-e/NFC-e, XSD público em
 * nfe.fazenda.gov.br). Cobre o caso comum do FaçaAmigos — Simples Nacional,
 * venda à vista, sem frete, ICMS por CSOSN — e assume PIS/COFINS "outras
 * operações" (CST 49) sem destaque de valor, típico do Simples.
 *
 * IMPORTANTE: este XML ainda não está assinado (ver assinatura.ts) e sua
 * conformidade byte a byte com o XSD oficial só é confirmada na Fase 5
 * (homologação), quando o manual e os arquivos de referência do Pará/SVRS
 * estiverem em mãos. Trate como "primeira aproximação testável", não como
 * verdade absoluta do layout.
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
}

export function montarXmlNfce(input: DocumentoFiscalInput): MontarXmlNfceResult {
  const emissao = new Date(input.dataHoraEmissao);
  if (Number.isNaN(emissao.getTime())) {
    throw new Error(`dataHoraEmissao inválida: "${input.dataHoraEmissao}"`);
  }

  const chaveAcesso = montarChaveAcesso({
    emissaoAno: emissao.getUTCFullYear(),
    emissaoMes: emissao.getUTCMonth() + 1,
    cnpj: input.emitente.cnpj,
    serie: input.serie,
    numero: input.numero,
    tipoEmissao: input.tipoEmissao,
    codigoNumerico: input.codigoNumerico,
  });
  const cDV = chaveAcesso.slice(-1);
  const cNF = chaveAcesso.slice(35, 43);

  const tpAmb = tpAmbFromAmbiente(input.ambiente);

  const vProd = input.itens.reduce((sum, item) => sum + item.valorTotal, 0);
  const vPag = input.pagamentos.reduce((sum, p) => sum + p.valor, 0);

  const det = input.itens.map((item, index) => ({
    "@nItem": String(index + 1),
    prod: {
      cProd: item.gtin === "SEM GTIN" ? String(index + 1) : item.gtin,
      cEAN: item.gtin,
      xProd: item.descricao,
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
      PIS: {
        PISOutr: { CST: item.pisCst, vBC: money(0), pPIS: money(0), vPIS: money(0) },
      },
      COFINS: {
        COFINSOutr: { CST: item.cofinsCst, vBC: money(0), pCOFINS: money(0), vCOFINS: money(0) },
      },
    },
  }));

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
      dhEmi: input.dataHoraEmissao,
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
      CNPJ: input.emitente.cnpj,
      xNome: input.emitente.razaoSocial,
      ...(input.emitente.nomeFantasia ? { xFant: input.emitente.nomeFantasia } : {}),
      enderEmit: {
        xLgr: input.emitente.endLogradouro,
        nro: input.emitente.endNumero,
        ...(input.emitente.endComplemento ? { xCpl: input.emitente.endComplemento } : {}),
        xBairro: input.emitente.endBairro,
        cMun: input.emitente.endMunicipioIbge,
        xMun: input.emitente.endMunicipioNome,
        UF: input.emitente.endUf,
        CEP: input.emitente.endCep.replace(/\D/g, ""),
        cPais: "1058",
        xPais: "BRASIL",
        ...(input.emitente.fone ? { fone: input.emitente.fone.replace(/\D/g, "") } : {}),
      },
      IE: input.emitente.inscricaoEstadual,
      CRT: String(input.emitente.crt),
    },
    ...(input.destinatario?.cpf
      ? {
          dest: {
            CPF: input.destinatario.cpf,
            ...(input.destinatario.nome ? { xNome: input.destinatario.nome } : {}),
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

  // Documento inteiro como um único objeto passado a `create(...)` — o modo
  // de conversão que o xmlbuilder2 documenta como estável: chaves "@..."
  // viram atributos, objetos aninhados viram elementos filhos, arrays viram
  // elementos irmãos repetidos (usado em `det` e `detPag` acima).
  const doc = {
    NFe: {
      "@xmlns": XMLNS_NFE,
      infNFe,
    },
  };

  const xml = create({ version: "1.0", encoding: "UTF-8" }, doc).end({
    prettyPrint: false,
    headless: false,
  });

  return { xml, chaveAcesso };
}
