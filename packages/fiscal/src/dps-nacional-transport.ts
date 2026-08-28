import { gunzipSync, gzipSync } from "node:zlib";
import { request } from "node:https";

/**
 * Transporte da DPS ao SEFIN Nacional do Sistema Nacional NFS-e —
 * `POST /SefinNacional/nfse`, mTLS com o certificado A1 do prestador (o
 * CNPJ do certificado precisa ter a mesma raiz do CNPJ do contribuinte,
 * conforme o Manual de Contribuintes da Prefeitura de Belém). O host
 * `adn.*.nfse.gov.br` (Ambiente de Dados Nacional) é só para
 * distribuição/consulta de documentos já autorizados (DFe, eventos) — a
 * emissão em si vai para o host `sefin.*.nfse.gov.br`, confirmado em
 * gov.br/nfse e no swagger público em
 * sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/ (2026-08-28,
 * corrigindo o host/path errados usados até então, que causavam HTTP 404
 * sem corpo). O mesmo endpoint central atende qualquer município
 * conveniado ao Sistema Nacional, não há host por município.
 */

const HOST_HOMOLOGACAO = "sefin.producaorestrita.nfse.gov.br";
const HOST_PRODUCAO = "sefin.nfse.gov.br";
const CANDIDATE_PATHS = [
  "/API/SefinNacional/nfse",
  "/SefinNacional/nfse",
];

export interface TransmitirDpsInput {
  /** DPS já assinada (XMLDSig), pronta para envio. */
  xmlAssinado: string;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  /** Certificado do emitente em PEM — mesmo par usado para assinar a DPS (mTLS = mesmo certificado, duas finalidades). */
  certPem: string;
  privateKeyPem: string;
  timeoutMs?: number;
}

export interface TransmitirDpsResultado {
  autorizado: boolean;
  httpStatus: number;
  tipoAmbiente: number | null;
  chaveAcesso: string | null;
  /** NFS-e em XML já decodificada (gunzip do nfseXmlGZipB64 da resposta) — só presente quando autorizado. */
  nfseXml: string | null;
  /** Mensagem de erro/motivo de rejeição, quando não autorizado — corpo bruto se não for JSON reconhecível. */
  mensagemErro: string | null;
  alertas: unknown[];
}

/**
 * POST síncrono à API ADN — a própria API já valida e gera a NFS-e numa
 * chamada só (sem lote/protocolo/consulta posterior, diferente do modelo
 * SEFAZ da NFC-e). Erros de rede/timeout sobem como exceção; respostas
 * HTTP de erro (400/403/500) voltam como resultado NÃO autorizado, nunca
 * como exceção — quem decide "documento fica bloqueado" é o chamador
 * (nfse.ts), não este módulo de transporte.
 */
export async function transmitirDps(input: TransmitirDpsInput): Promise<TransmitirDpsResultado> {
  const host = input.ambiente === "PRODUCAO" ? HOST_PRODUCAO : HOST_HOMOLOGACAO;
  const dpsXmlGZipB64 = gzipSync(Buffer.from(input.xmlAssinado, "utf-8")).toString("base64");
  const body = JSON.stringify({ dpsXmlGZipB64 });

  let lastStatus = 0;
  let lastRaw = "";

  for (const path of CANDIDATE_PATHS) {
    const { status, raw } = await new Promise<{ status: number; raw: string }>((resolve, reject) => {
      const req = request(
        {
          host,
          path,
          method: "POST",
          cert: input.certPem,
          key: input.privateKeyPem,
          timeout: input.timeoutMs ?? 30_000,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, raw: Buffer.concat(chunks).toString("utf-8") }));
        },
      );
      req.on("timeout", () => req.destroy(new Error("Tempo esgotado ao transmitir a DPS ao Sistema Nacional NFS-e (ADN).")));
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    lastStatus = status;
    lastRaw = raw;

    // Se não for 404, não tenta a próxima rota candidata
    if (status !== 404) {
      break;
    }
  }

  const status = lastStatus;
  const raw = lastRaw;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (status === 201 && parsed?.nfseXmlGZipB64) {
    const nfseXml = gunzipSync(Buffer.from(String(parsed.nfseXmlGZipB64), "base64")).toString("utf-8");
    return {
      autorizado: true,
      httpStatus: status,
      tipoAmbiente: typeof parsed.tipoAmbiente === "number" ? parsed.tipoAmbiente : null,
      chaveAcesso: typeof parsed.chaveAcesso === "string" ? parsed.chaveAcesso : null,
      nfseXml,
      mensagemErro: null,
      alertas: Array.isArray(parsed.alertas) ? parsed.alertas : [],
    };
  }

  const mensagemErro =
    (parsed && (parsed.mensagem ?? parsed.message ?? parsed.error)) != null
      ? String((parsed as Record<string, unknown>).mensagem ?? (parsed as Record<string, unknown>).message ?? (parsed as Record<string, unknown>).error)
      : raw || `HTTP ${status} sem corpo de resposta`;

  return {
    autorizado: false,
    httpStatus: status,
    tipoAmbiente: null,
    chaveAcesso: null,
    nfseXml: null,
    mensagemErro,
    alertas: Array.isArray(parsed?.alertas) ? (parsed!.alertas as unknown[]) : [],
  };
}
