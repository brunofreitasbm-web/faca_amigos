/**
 * Chave de acesso da NFC-e: 44 dígitos que identificam o documento de forma
 * única em todo o país, formados por 43 campos fixos + 1 dígito verificador
 * (módulo 11). É o que vai no QR Code, no código de barras do DANFE e no
 * nome do arquivo XML.
 *
 * Layout (Manual de Orientação do Contribuinte, campo `chNFe`):
 *   cUF (2) + AAMM (4) + CNPJ (14) + mod (2) + serie (3) + nNF (9) + tpEmis (1) + cNF (8) + DV (1)
 *
 * cUF = 15 para o Pará. mod = 65 para NFC-e.
 */

const CUF_PARA = "15";
const MODELO_NFCE = "65";

export interface ChaveAcessoInput {
  /** Ano e mês de emissão. */
  emissaoAno: number;
  emissaoMes: number;
  /** Só dígitos, 14 caracteres. */
  cnpj: string;
  /** Série da NFC-e (numérica, sem zeros à esquerda na entrada). */
  serie: number;
  /** Número do documento. */
  numero: number;
  /** Forma de emissão: 1 = normal, 9 = contingência offline. */
  tipoEmissao: 1 | 9;
  /**
   * Código numérico aleatório de 8 dígitos (`cNF`), gerado pelo emissor —
   * não confundir com o dígito verificador, que é calculado por esta função.
   */
  codigoNumerico: string;
}

function padLeft(value: string | number, length: number): string {
  return String(value).padStart(length, "0");
}

/**
 * Dígito verificador módulo 11, conforme o algoritmo do MOC da NF-e: pesos
 * de 2 a 9 aplicados da direita para a esquerda, repetindo o ciclo; resto 0
 * ou 1 vira dígito 0.
 */
export function calcularDigitoVerificadorModulo11(base: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = base.length - 1; i >= 0; i -= 1) {
    sum += Number(base[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * Monta os 43 dígitos da chave (sem o DV) a partir dos campos do documento.
 */
export function montarChaveAcessoSemDv(input: ChaveAcessoInput): string {
  const aamm = padLeft(input.emissaoAno % 100, 2) + padLeft(input.emissaoMes, 2);
  const cnpj = input.cnpj.replace(/\D/g, "");
  if (cnpj.length !== 14) {
    throw new Error(`CNPJ precisa ter 14 dígitos, recebeu "${input.cnpj}"`);
  }
  const codigoNumerico = padLeft(input.codigoNumerico, 8).slice(-8);

  return [
    CUF_PARA,
    aamm,
    cnpj,
    MODELO_NFCE,
    padLeft(input.serie, 3),
    padLeft(input.numero, 9),
    String(input.tipoEmissao),
    codigoNumerico,
  ].join("");
}

/** Monta a chave de acesso completa (44 dígitos, com o DV no fim). */
export function montarChaveAcesso(input: ChaveAcessoInput): string {
  const semDv = montarChaveAcessoSemDv(input);
  return semDv + String(calcularDigitoVerificadorModulo11(semDv));
}

/** Confere se uma chave de 44 dígitos tem o DV correto para o corpo dela. */
export function validarChaveAcesso(chave: string): boolean {
  const digits = chave.replace(/\D/g, "");
  if (digits.length !== 44) return false;
  const body = digits.slice(0, 43);
  const dv = Number(digits[43]);
  return calcularDigitoVerificadorModulo11(body) === dv;
}

/** Formata a chave em 11 grupos de 4 dígitos, para exibir no DANFE. */
export function formatarChaveAcessoEmGrupos(chave: string): string {
  const digits = chave.replace(/\D/g, "");
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 4) {
    groups.push(digits.slice(i, i + 4));
  }
  return groups.join(" ");
}

/**
 * Gera uma chave de acesso NFC-e válida de 44 dígitos (SEFAZ-PA cUF=15, mod=65)
 * com fallback seguro para caso campos opcionais não estejam presentes.
 */
export function gerarChaveAcessoNfceOuFallback(params: {
  emissaoData?: Date | number | string | null;
  cnpj?: string | null;
  serie?: number | string | null;
  numero?: number | string | null;
  tipoEmissao?: 1 | 9 | null;
  seedId?: string | null;
}): string {
  const d = params.emissaoData ? new Date(params.emissaoData) : new Date();
  const year = isNaN(d.getFullYear()) ? new Date().getFullYear() : d.getFullYear();
  const month = isNaN(d.getMonth()) ? new Date().getMonth() + 1 : d.getMonth() + 1;

  const rawCnpj = (params.cnpj ?? "").replace(/\D/g, "");
  const cnpj = rawCnpj.length === 14 ? rawCnpj : "00000000000191";

  const serie = Number(params.serie) || 1;
  const numero = Number(params.numero) || 1;
  const tipoEmissao = params.tipoEmissao === 9 ? 9 : 1;

  const rawSeed = (params.seedId ?? "").replace(/\D/g, "");
  const codigoNumerico = (rawSeed + "87654321").slice(-8);

  return montarChaveAcesso({
    emissaoAno: year,
    emissaoMes: month,
    cnpj,
    serie,
    numero,
    tipoEmissao,
    codigoNumerico,
  });
}

