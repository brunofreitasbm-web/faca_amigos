import { request } from "node:https";
import { DOMParser } from "@xmldom/xmldom";
import { montarCaBundle } from "./ca-bundle.js";
import {
  assinarXmlEvento,
  assinarXmlInutilizacao,
  montarXmlCancelamento,
  montarXmlInutilizacao,
} from "../eventos-xml.js";
import type { FiscalAmbiente } from "../types.js";
import type {
  AutorizacaoResultado,
  CancelamentoResultado,
  InutilizacaoResultado,
  NfceTransport,
  StatusServicoResultado,
} from "./transport.js";


const SVRS_HOSTS = {
  HOMOLOGACAO: "nfce-homologacao.svrs.rs.gov.br",
  PRODUCAO: "nfce.svrs.rs.gov.br",
};

const PATHS = {
  STATUS_SERVICO: "/ws/NfeStatusServico/NfeStatusServico4.asmx",
  AUTORIZACAO: "/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
  RET_AUTORIZACAO: "/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
  CONSULTA: "/ws/NfeConsulta/NfeConsulta4.asmx",
  EVENTO: "/ws/RecepcaoEvento/RecepcaoEvento4.asmx",
  INUTILIZACAO: "/ws/NfeInutilizacao/NfeInutilizacao4.asmx",
};

export interface SvrsTransportOptions {
  certPem: string;
  privateKeyPem: string;
  timeoutMs?: number;
}

export class SvrsNfceTransport implements NfceTransport {
  private certPem: string;
  private privateKeyPem: string;
  private timeoutMs: number;

  constructor(options: SvrsTransportOptions) {
    this.certPem = options.certPem;
    this.privateKeyPem = options.privateKeyPem;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async postSoap(
    ambiente: FiscalAmbiente,
    path: string,
    action: string,
    bodyXml: string,
  ): Promise<string> {
    const host = ambiente === "PRODUCAO" ? SVRS_HOSTS.PRODUCAO : SVRS_HOSTS.HOMOLOGACAO;
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    ${bodyXml}
  </soap12:Body>
</soap12:Envelope>`;

    return new Promise((resolve, reject) => {
      const req = request(
        {
          host,
          path,
          method: "POST",
          cert: this.certPem,
          key: this.privateKeyPem,
          ca: montarCaBundle(),
          servername: host,
          timeout: this.timeoutMs,
          headers: {
            "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"`,
            "Content-Length": Buffer.byteLength(soapEnvelope, "utf-8"),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(raw);
            } else {
              reject(new Error(`Erro HTTP ${res.statusCode} na SVRS: ${raw || res.statusMessage}`));
            }
          });
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error(`Tempo limite de ${this.timeoutMs}ms excedido na comunicação com a SVRS.`));
      });
      req.on("error", reject);
      req.write(soapEnvelope, "utf-8");
      req.end();
    });
  }

  async consultarStatusServico(ambiente: FiscalAmbiente): Promise<StatusServicoResultado> {
    const tpAmb = ambiente === "PRODUCAO" ? "1" : "2";
    const bodyXml = `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeStatusServico4">
      <consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>${tpAmb}</tpAmb>
        <cUF>15</cUF>
        <xServ>STATUS</xServ>
      </consStatServ>
    </nfeDadosMsg>`;

    try {
      const xmlRes = await this.postSoap(
        ambiente,
        PATHS.STATUS_SERVICO,
        "http://www.portalfiscal.inf.br/nfe/wsdl/NfeStatusServico4/nfeStatusServicoNF",
        bodyXml,
      );

      const doc = new DOMParser().parseFromString(xmlRes, "text/xml");
      const cStatEl = doc.getElementsByTagName("cStat")[0];
      const xMotivoEl = doc.getElementsByTagName("xMotivo")[0];

      const cstat = cStatEl?.textContent ?? "999";
      const xmotivo = xMotivoEl?.textContent ?? "Sem resposta legível da SVRS";

      return {
        online: cstat === "107", // 107 = Serviço em Operação
        cstat,
        xmotivo,
      };
    } catch (err) {
      return {
        online: false,
        cstat: "999",
        xmotivo: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async autorizar(xmlAssinado: string, ambiente: FiscalAmbiente): Promise<AutorizacaoResultado> {
    const idLote = String(Date.now()).slice(-9);
    const bodyXml = `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
      <enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <idLote>${idLote}</idLote>
        <indSinc>1</indSinc>
        ${xmlAssinado.replace(/<\?xml.*?\?>/g, "")}
      </enviNFe>
    </nfeDadosMsg>`;

    try {
      const xmlRes = await this.postSoap(
        ambiente,
        PATHS.AUTORIZACAO,
        "http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote",
        bodyXml,
      );

      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlRes, "text/xml");

      const protNFeEl = doc.getElementsByTagName("protNFe")[0];
      const infProt = doc.getElementsByTagName("infProt")[0];

      let cstat = "999";
      let xmotivo = "Resposta da SVRS não contém protocolo de autorização";
      let protocolo: string | null = null;
      let autorizado = false;

      if (infProt) {
        cstat = infProt.getElementsByTagName("cStat")[0]?.textContent ?? "999";
        xmotivo = infProt.getElementsByTagName("xMotivo")[0]?.textContent ?? "";
        protocolo = infProt.getElementsByTagName("nProt")[0]?.textContent ?? null;
        autorizado = cstat === "100" || cstat === "150";
      } else {
        const retEnviNFe = doc.getElementsByTagName("retEnviNFe")[0];
        if (retEnviNFe) {
          cstat = retEnviNFe.getElementsByTagName("cStat")[0]?.textContent ?? "999";
          xmotivo = retEnviNFe.getElementsByTagName("xMotivo")[0]?.textContent ?? xmotivo;
        }
      }

      let xmlAutorizado: string | null = null;
      if (autorizado && protNFeEl) {
        const protXmlStr = protNFeEl.toString();
        const cleanSignedXml = xmlAssinado.replace(/<\?xml.*?\?>/g, "").trim();
        xmlAutorizado = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${cleanSignedXml}${protXmlStr}</nfeProc>`;
      }

      return {
        autorizado,
        cstat,
        xmotivo,
        protocolo,
        xmlAutorizado,
      };
    } catch (err) {
      return {
        autorizado: false,
        cstat: "999",
        xmotivo: err instanceof Error ? err.message : String(err),
        protocolo: null,
        xmlAutorizado: null,
      };
    }
  }

  async consultarPorChave(chaveAcesso: string, ambiente: FiscalAmbiente): Promise<AutorizacaoResultado> {
    const tpAmb = ambiente === "PRODUCAO" ? "1" : "2";
    const bodyXml = `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeConsulta4">
      <consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>${tpAmb}</tpAmb>
        <xServ>CONSULTAR</xServ>
        <chNFe>${chaveAcesso}</chNFe>
      </consSitNFe>
    </nfeDadosMsg>`;

    try {
      const xmlRes = await this.postSoap(
        ambiente,
        PATHS.CONSULTA,
        "http://www.portalfiscal.inf.br/nfe/wsdl/NfeConsulta4/nfeConsultaNF",
        bodyXml,
      );

      const doc = new DOMParser().parseFromString(xmlRes, "text/xml");
      const infProt = doc.getElementsByTagName("infProt")[0];
      const protNFeEl = doc.getElementsByTagName("protNFe")[0];

      if (infProt) {
        const cstat = infProt.getElementsByTagName("cStat")[0]?.textContent ?? "999";
        const xmotivo = infProt.getElementsByTagName("xMotivo")[0]?.textContent ?? "";
        const protocolo = infProt.getElementsByTagName("nProt")[0]?.textContent ?? null;
        const autorizado = cstat === "100" || cstat === "150";

        return {
          autorizado,
          cstat,
          xmotivo,
          protocolo,
          xmlAutorizado: protNFeEl ? protNFeEl.toString() : null,
        };
      }

      const retConsSit = doc.getElementsByTagName("retConsSitNFe")[0];
      const cstat = retConsSit?.getElementsByTagName("cStat")[0]?.textContent ?? "999";
      const xmotivo = retConsSit?.getElementsByTagName("xMotivo")[0]?.textContent ?? "Consulta sem retorno de protocolo";

      return {
        autorizado: false,
        cstat,
        xmotivo,
        protocolo: null,
        xmlAutorizado: null,
      };
    } catch (err) {
      return {
        autorizado: false,
        cstat: "999",
        xmotivo: err instanceof Error ? err.message : String(err),
        protocolo: null,
        xmlAutorizado: null,
      };
    }
  }

  async cancelar(
    chaveAcesso: string,
    protocolo: string,
    justificativa: string,
    ambiente: FiscalAmbiente,
    cnpj = "00000000000000",
  ): Promise<CancelamentoResultado> {
    try {
      const { xml, idEvento } = montarXmlCancelamento({
        chaveAcesso,
        cnpj,
        protocolo,
        justificativa,
        ambiente,
      });

      const xmlAssinado = assinarXmlEvento({
        xml,
        idEvento,
        privateKeyPem: this.privateKeyPem,
        certPem: this.certPem,
      });

      const bodyXml = `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeRecepcaoEvento4">
        <envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
          <idLote>1</idLote>
          ${xmlAssinado.replace(/<\?xml.*?\?>/g, "")}
        </envEvento>
      </nfeDadosMsg>`;

      const xmlRes = await this.postSoap(
        ambiente,
        PATHS.EVENTO,
        "http://www.portalfiscal.inf.br/nfe/wsdl/NfeRecepcaoEvento4/nfeRecepcaoEvento",
        bodyXml,
      );

      const doc = new DOMParser().parseFromString(xmlRes, "text/xml");
      const infEvento = doc.getElementsByTagName("infEvento")[0];

      let cstat = "999";
      let xmotivo = "Sem retorno de evento da SEFAZ";
      let nProt: string | null = null;

      if (infEvento) {
        cstat = infEvento.getElementsByTagName("cStat")[0]?.textContent ?? "999";
        xmotivo = infEvento.getElementsByTagName("xMotivo")[0]?.textContent ?? "";
        nProt = infEvento.getElementsByTagName("nProt")[0]?.textContent ?? null;
      }

      const aprovado = cstat === "135" || cstat === "155";

      return {
        aprovado,
        cstat,
        xmotivo,
        protocolo: nProt,
      };
    } catch (err) {
      return {
        aprovado: false,
        cstat: "999",
        xmotivo: err instanceof Error ? err.message : String(err),
        protocolo: null,
      };
    }
  }

  async inutilizar(
    serie: number,
    numeroInicial: number,
    numeroFinal: number,
    justificativa: string,
    ambiente: FiscalAmbiente,
    cnpj = "00000000000000",
  ): Promise<InutilizacaoResultado> {
    try {
      const ano = Number(new Date().getFullYear().toString().slice(-2));
      const { xml, idInut } = montarXmlInutilizacao({
        cnpj,
        ano,
        serie,
        numeroInicial,
        numeroFinal,
        justificativa,
        ambiente,
      });

      const xmlAssinado = assinarXmlInutilizacao({
        xml,
        idInut,
        privateKeyPem: this.privateKeyPem,
        certPem: this.certPem,
      });

      const bodyXml = `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeInutilizacao4">
        ${xmlAssinado.replace(/<\?xml.*?\?>/g, "")}
      </nfeDadosMsg>`;

      const xmlRes = await this.postSoap(
        ambiente,
        PATHS.INUTILIZACAO,
        "http://www.portalfiscal.inf.br/nfe/wsdl/NfeInutilizacao4/nfeInutilizacaoNF",
        bodyXml,
      );

      const doc = new DOMParser().parseFromString(xmlRes, "text/xml");
      const infInut = doc.getElementsByTagName("infInut")[0];

      let cstat = "999";
      let xmotivo = "Sem retorno de inutilização da SEFAZ";
      let nProt: string | null = null;

      if (infInut) {
        cstat = infInut.getElementsByTagName("cStat")[0]?.textContent ?? "999";
        xmotivo = infInut.getElementsByTagName("xMotivo")[0]?.textContent ?? "";
        nProt = infInut.getElementsByTagName("nProt")[0]?.textContent ?? null;
      }

      const homologada = cstat === "102";

      return {
        homologada,
        cstat,
        xmotivo,
        protocolo: nProt,
      };
    } catch (err) {
      return {
        homologada: false,
        cstat: "999",
        xmotivo: err instanceof Error ? err.message : String(err),
        protocolo: null,
      };
    }
  }
}

