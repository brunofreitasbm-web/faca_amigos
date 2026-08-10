import type { DocumentoFiscalInput, FiscalAmbiente } from "../types.js";

/**
 * Interface de transporte com a SVRS (Sefaz Virtual do Rio Grande do Sul,
 * autorizadora da NFC-e para o Pará desde 02/09/2019). Implementada na
 * Fase 5 do plano, dentro do worker Electron (apps/kiosk/src/fiscal/nfce/) —
 * mTLS com o certificado A1, envelope SOAP escrito à mão (o da SEFAZ são
 * ~10 linhas fixas; a lib `soap` não compensa).
 *
 * Este arquivo parece indireção desnecessária hoje. Não é: é o ÚNICO lugar
 * que muda se algum dia precisarmos trocar de implementação — seja por uma
 * biblioteca mantida (candidato: nfewizard-io, por causa da Reforma
 * Tributária mexendo no layout em 2026/2027), seja pelo plano B em PHP
 * (nfephp-org/sped-nfe) se o gatilho de 10 dias úteis sem autorizar disparar
 * na Fase 5. O resto do sistema (fila, worker, backoffice) nunca precisa
 * saber qual XML/protocolo está por trás desta interface.
 */

export interface StatusServicoResultado {
  online: boolean;
  cstat: string;
  xmotivo: string;
}

export interface AutorizacaoResultado {
  /** true quando cStat=100 (autorizado). */
  autorizado: boolean;
  cstat: string;
  xmotivo: string;
  protocolo: string | null;
  /** XML completo, com o protocolo de autorização anexado — o que vai para o disco/Storage. */
  xmlAutorizado: string | null;
}

export interface CancelamentoResultado {
  aprovado: boolean;
  cstat: string;
  xmotivo: string;
  protocolo: string | null;
}

export interface InutilizacaoResultado {
  homologada: boolean;
  cstat: string;
  xmotivo: string;
  protocolo: string | null;
}

export interface NfceTransport {
  /** NfeStatusServico — a chamada mais simples, prova mTLS + certificado + rede numa tacada. */
  consultarStatusServico(ambiente: FiscalAmbiente): Promise<StatusServicoResultado>;

  /** NFeAutorizacao + NFeRetAutorizacao, já com o XML assinado. */
  autorizar(xmlAssinado: string, ambiente: FiscalAmbiente): Promise<AutorizacaoResultado>;

  /** NfeConsulta, por chave de acesso — usado no catch-up após queda de rede. */
  consultarPorChave(chaveAcesso: string, ambiente: FiscalAmbiente): Promise<AutorizacaoResultado>;

  /** RecepcaoEvento de cancelamento, dentro da janela legal de 24h (confirmada com o contador — reconfirmar contra o manual da SVRS na Fase 5). */
  cancelar(
    chaveAcesso: string,
    protocolo: string,
    justificativa: string,
    ambiente: FiscalAmbiente,
  ): Promise<CancelamentoResultado>;

  /** NfeInutilizacao — faixas de numeração queimadas por rejeição. */
  inutilizar(
    serie: number,
    numeroInicial: number,
    numeroFinal: number,
    justificativa: string,
    ambiente: FiscalAmbiente,
  ): Promise<InutilizacaoResultado>;
}

/**
 * Reexportado aqui só para deixar claro, no ponto de uso, qual é o formato
 * de entrada esperado antes de chamar `autorizar` — a montagem e a
 * assinatura acontecem em nfce-xml.ts/assinatura.ts, não neste módulo.
 */
export type { DocumentoFiscalInput };
