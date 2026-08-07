/**
 * Tipos compartilhados pela emissão de NFC-e. Espelham o payload que
 * `fa_fiscal_claim_next` (supabase/migrations/20260806000032_...) devolve ao
 * worker — mantidos separados do schema do banco para o pacote continuar
 * puro e testável sem depender do cliente Supabase.
 */

export type FiscalAmbiente = "HOMOLOGACAO" | "PRODUCAO";

/** "1" = produção, "2" = homologação — código usado no XML e no QR Code. */
export type TpAmb = "1" | "2";

export function tpAmbFromAmbiente(ambiente: FiscalAmbiente): TpAmb {
  return ambiente === "PRODUCAO" ? "1" : "2";
}

export interface Emitente {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  inscricaoEstadual: string;
  /** 1 = Simples Nacional. */
  crt: number;
  endLogradouro: string;
  endNumero: string;
  endComplemento: string | null;
  endBairro: string;
  endMunicipioIbge: string;
  /** Nome do município por extenso — o XML exige, o código IBGE não basta. */
  endMunicipioNome: string;
  endUf: string;
  endCep: string;
  fone: string | null;
}

export interface Destinatario {
  /** Só dígitos. null = consumidor não identificado (o caso comum na NFC-e). */
  cpf: string | null;
  nome: string | null;
}

export interface ItemFiscal {
  descricao: string;
  quantidade: number;
  /** Em reais (não centavos) — o layout do XML usa valor decimal. */
  valorUnitario: number;
  valorTotal: number;
  ncm: string;
  cest: string | null;
  cfop: string;
  csosn: string;
  /** 0 = nacional. */
  origem: number;
  unidadeComercial: string;
  gtin: string;
  pisCst: string;
  cofinsCst: string;
}

/** Espelha fa_kiosk_payments.method — mapeado para o tPag do XML em nfce-xml.ts. */
export type FormaPagamento = "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO" | "VOUCHER";

export interface PagamentoFiscal {
  metodo: FormaPagamento;
  valor: number;
}

export interface DocumentoFiscalInput {
  ambiente: FiscalAmbiente;
  serie: number;
  numero: number;
  /** Código numérico aleatório de 8 dígitos usado na chave de acesso (cNF). */
  codigoNumerico: string;
  /** Forma de emissão: 1 = normal, 9 = contingência offline. */
  tipoEmissao: 1 | 9;
  /** ISO 8601 com timezone, ex. "2026-08-07T14:30:00-03:00". */
  dataHoraEmissao: string;
  /** Preenchido só quando tipoEmissao = 9. */
  contingencia: { dataHoraEntrada: string; justificativa: string } | null;
  emitente: Emitente;
  destinatario: Destinatario | null;
  itens: ItemFiscal[];
  pagamentos: PagamentoFiscal[];
}

export interface ResultadoEmissao {
  chaveAcesso: string;
  protocolo: string;
  cstat: string;
  xmotivo: string;
  xmlAutorizado: string;
}
