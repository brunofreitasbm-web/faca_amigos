import { create } from "xmlbuilder2";
import { formatarDataFiscal, formatarDataHoraFiscal } from "./data-hora.js";
import { sanitizarTextoFiscal } from "./texto.js";

/**
 * Monta o XML da DPS (Declaração de Prestação de Serviços) no Modelo
 * Nacional de NFS-e (SEFIN Nacional / ADN, XSD público v1.01 em
 * gov.br/nfse), ainda sem assinatura (ver assinatura.ts, `assinarXmlDps`).
 *
 * Cobre só o caso do FaçaAmigos: prestador PJ Simples Nacional emitindo
 * (`tpEmit=1`), tomador pessoa física (Responsável, sem endereço — o item
 * de serviço "12.xx" tem incidência no local da prestação, não no
 * domicílio do tomador), sem substituição de nota, sem operação com o
 * exterior, sem intermediário, grupo IBSCBS omitido (opcional no schema e
 * sem regra de negócio ativa na v1.01 — fase de transição da reforma
 * tributária). Campos e regras confirmados linha a linha contra
 * DPS_v1.01.xsd/tiposComplexos_v1.01.xsd e o Anexo I (regras de negócio)
 * de 2026-08-19 — ver comentários pontuais abaixo para as decisões menos
 * óbvias.
 *
 * dhEmi/dCompet/dtIni/dtFim usam o dia/mês LOCAL (fuso `input.timeZone`,
 * padrão America/Belem — ver data-hora.ts), não UTC. Todo campo de texto
 * livre (xNome, xDescServ, xLgr, xCpl, xBairro) passa por
 * `sanitizarTextoFiscal` (texto.ts) antes de entrar no XML, porque o
 * layout usa faixa ISO-8859-1 e não aceita emoji/tipografia "esperta".
 */

export interface DpsPrestador {
  cnpj: string;
  /** Inscrição municipal — só enviar se a unidade tiver registro complementar no CNC do município (RN #122); senão omitir. */
  inscricaoMunicipal?: string | null;
}

export interface DpsTomador {
  cpf: string;
  nome: string;
}

export interface DpsEnderecoEvento {
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
}

export interface DpsInput {
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  /** Instante da emissão (Date real, não string) — vira dhEmi local com offset numérico. */
  dataHoraEmissao: Date;
  /** Data de início da prestação (competência) — normalmente a mesma data da sessão. */
  dataCompetencia: Date;
  serieDps: string;
  numeroDps: number;
  /** Código IBGE do município emissor/de prestação — Belém = 1501402. */
  codigoMunicipioIbge: string;
  prestador: DpsPrestador;
  tomador: DpsTomador;
  /** Código de tributação nacional (6 dígitos: item+subitem+desdobro LC116) — ex. 120501, parques de diversão/lazer. */
  codigoTribNacional: string;
  /** Código de tributação municipal específico de Belém, se parametrizado — opcional. */
  codigoTribMunicipal?: string | null;
  descricaoServico: string;
  /** Endereço do playground — obrigatório por regra de negócio para o item 12 (grupo atvEvento). */
  enderecoEvento: DpsEnderecoEvento;
  valorServico: number;
  /**
   * Alíquota manual do ISS (%) — deixar de fora neste momento: o convênio
   * de Belém no Sistema Nacional está "Ativo" (confirmado 2026-08-19), e
   * com convênio ativo + sem retenção (RN #429) o sistema nacional calcula
   * a alíquota sozinho. Só voltaria a ser necessário se o convênio saísse
   * do ar.
   */
  aliquotaIssManual?: number | null;
  /** Fuso horário usado para dhEmi/dCompet/dtIni/dtFim — padrão "America/Belem". */
  timeZone?: string;
}

function money(value: number): string {
  return value.toFixed(2);
}

/**
 * TSIdDPS (45 posições): "DPS" + cód.município (7) + tipo insc. federal (1,
 * "2"=CNPJ) + inscrição federal (14, CNPJ sem padding) + série (5, zero à
 * esquerda) + número (15, zero à esquerda). Usado como atributo Id do
 * infDPS e como alvo da assinatura (Reference URI="#<id>").
 */
export function montarIdDps(input: Pick<DpsInput, "codigoMunicipioIbge" | "prestador" | "serieDps" | "numeroDps">): string {
  const municipio = input.codigoMunicipioIbge.padStart(7, "0");
  const cnpj = input.prestador.cnpj.replace(/\D/g, "").padStart(14, "0");
  const serie = input.serieDps.replace(/\D/g, "").padStart(5, "0");
  const numero = String(input.numeroDps).padStart(15, "0");
  return `DPS${municipio}2${cnpj}${serie}${numero}`;
}

export interface MontarXmlDpsResult {
  xml: string;
  idDps: string;
}

export function montarXmlDps(input: DpsInput): MontarXmlDpsResult {
  const idDps = montarIdDps(input);
  const tpAmb = input.ambiente === "PRODUCAO" ? "1" : "2";
  const tz = input.timeZone ?? "America/Belem";
  const descricaoServicoSanitizada = sanitizarTextoFiscal(input.descricaoServico, 255);
  // cTribMun só entra quando há um código municipal válido e diferente de
  // zero — "0"/vazio/ausente não é um código real.
  const cTribMunDigits = input.codigoTribMunicipal?.replace(/\D/g, "");

  const infDPS: Record<string, unknown> = {
    "@Id": idDps,
    tpAmb,
    dhEmi: formatarDataHoraFiscal(input.dataHoraEmissao, tz),
    verAplic: "facaamigos-1.0",
    serie: input.serieDps.replace(/\D/g, ""),
    nDPS: String(input.numeroDps),
    dCompet: formatarDataFiscal(input.dataCompetencia, tz),
    tpEmit: "1",
    cLocEmi: input.codigoMunicipioIbge,
    prest: {
      CNPJ: input.prestador.cnpj.replace(/\D/g, ""),
      // xNome/end do prestador não são enviados quando tpEmit=1 (RN #126/#129) —
      // o sistema nacional já conhece esses dados pelo cadastro do CNPJ.
      ...(input.prestador.inscricaoMunicipal ? { IM: input.prestador.inscricaoMunicipal } : {}),
      regTrib: {
        opSimpNac: "3",
        regApTribSN: "1",
        regEspTrib: "0",
      },
    },
    toma: {
      CPF: input.tomador.cpf.replace(/\D/g, ""),
      xNome: sanitizarTextoFiscal(input.tomador.nome, 300),
    },
    serv: {
      locPrest: { cLocPrestacao: input.codigoMunicipioIbge },
      cServ: {
        cTribNac: input.codigoTribNacional,
        ...(cTribMunDigits && Number(cTribMunDigits) > 0 ? { cTribMun: cTribMunDigits } : {}),
        xDescServ: descricaoServicoSanitizada,
      },
      // Obrigatório por regra de negócio (não pelo XSD) quando cTribNac
      // pertence ao item 12 da lista de serviços — RN Anexo I linha 277.
      atvEvento: {
        xNome: descricaoServicoSanitizada,
        dtIni: formatarDataFiscal(input.dataCompetencia, tz),
        dtFim: formatarDataFiscal(input.dataCompetencia, tz),
        end: {
          CEP: input.enderecoEvento.cep.replace(/\D/g, ""),
          xLgr: sanitizarTextoFiscal(input.enderecoEvento.logradouro, 125),
          nro: input.enderecoEvento.numero,
          ...(input.enderecoEvento.complemento
            ? { xCpl: sanitizarTextoFiscal(input.enderecoEvento.complemento, 60) }
            : {}),
          xBairro: sanitizarTextoFiscal(input.enderecoEvento.bairro, 60),
        },
      },
    },
    valores: {
      vServPrest: { vServ: money(input.valorServico) },
      trib: {
        tribMun: {
          tribISSQN: "1",
          tpRetISSQN: "1",
          ...(input.aliquotaIssManual != null ? { pAliq: input.aliquotaIssManual.toFixed(2) } : {}),
        },
        // indTotTrib=0: opção mais simples do choice de totTrib, válida para
        // qualquer ME/EPP (só é vedada a MEI) — não estima tributos federais
        // aproximados em vez de arriscar um percentual de SN incorreto.
        totTrib: { indTotTrib: "0" },
      },
    },
  };

  const doc = {
    DPS: {
      "@xmlns": "http://www.sped.fazenda.gov.br/nfse",
      "@versao": "1.01",
      infDPS,
    },
  };

  const xml = create({ version: "1.0", encoding: "UTF-8" }, doc).end({ prettyPrint: false, headless: false });
  return { xml, idDps };
}
