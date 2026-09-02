import type { SupabaseClient } from "@supabase/supabase-js";
import { readCredentials, type CofreCrypto } from "./vault.js";

/**
 * Credenciais fiscais (certificado A1 + CSC da NFC-e) prontas para uso pelo
 * worker, vindas de uma de duas fontes:
 *
 *  1. Cofre local do terminal (vault.ts) — só existe quando o certificado
 *     foi instalado manualmente neste PC. Não carrega `cscId` (o cofre
 *     local só guarda o token, nunca o id — ver `CofreCredenciais`).
 *  2. Edge Function `nfse-certificate-fetch` — upload feito via Painel
 *     Gerencial, servido pela nuvem para qualquer terminal (inclusive um
 *     segundo terminal de failover, M4 do plano).
 *
 * Este módulo é o ÚNICO lugar que chama `nfse-certificate-fetch` — antes
 * NFS-e (nfse.ts) e NFC-e (claim.ts) duplicavam a chamada e o parsing de
 * erro cada um do seu jeito, com um header manual de Authorization que na
 * verdade quebra a autorização da função (ver comentário abaixo).
 */

export interface CredenciaisFiscais {
  pfxBuffer: Buffer;
  password: string;
  /** null quando a fonte foi o cofre local (que não guarda o id do CSC) ou quando a unidade não tem CSC cadastrado na nuvem. */
  cscId: string | null;
  cscToken: string | null;
}

export type ResultadoCredenciais =
  | { ok: true; credenciais: CredenciaisFiscais }
  | { ok: false; motivo: string };

interface NfseCertificateFetchResponse {
  pfxBase64: string;
  password: string;
  cscId: string | null;
  cscToken: string | null;
}

/**
 * Extrai uma mensagem de erro legível do retorno de `supabase.functions.invoke`.
 * A lib devolve o corpo da resposta HTTP como um `Response` dentro de
 * `error.context` — precisa ser lido de forma assíncrona (`.text()`), e o
 * corpo pode ser JSON (`{ error }` / `{ message }`) ou texto cru.
 */
async function extrairDetalheErro(error: { message?: string; context?: unknown } | null): Promise<string> {
  let detail = error?.message ?? "não configurado em Configurações → Fiscal";
  if (error && "context" in error && error.context instanceof Response) {
    try {
      const bodyText = await error.context.clone().text();
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed?.error) detail = parsed.error;
        else if (parsed?.message) detail = parsed.message;
        else if (bodyText) detail = `HTTP ${error.context.status}: ${bodyText}`;
      } catch {
        if (bodyText) detail = `HTTP ${error.context.status}: ${bodyText}`;
      }
    } catch {
      // mantém a mensagem de erro padrão se a leitura do corpo falhar
    }
  }
  return detail;
}

/**
 * Busca as credenciais fiscais (.pfx + senha + CSC) para uma unidade,
 * tentando primeiro o cofre local (quando `vaultParams` é informado) e
 * caindo para a Edge Function em seguida.
 *
 * IMPORTANTE: não passamos nenhum header `Authorization` manual — o
 * `supabase.functions.invoke` já envia a `secretKey` com que o cliente do
 * worker foi criado (ver fiscal/index.ts) como bearer automaticamente, e a
 * função autoriza comparando esse bearer contra `SUPABASE_SERVICE_ROLE_KEY`
 * ou `FISCAL_WORKER_SECRET_KEY`. Um header manual construído aqui
 * sobrescreveria esse bearer e quebraria a autorização.
 */
export async function buscarCredenciaisFiscais(
  supabase: SupabaseClient,
  unitId: string,
  vaultParams?: { userDataPath: string; crypto: CofreCrypto },
): Promise<ResultadoCredenciais> {
  if (vaultParams) {
    const creds = readCredentials(vaultParams);
    if (creds) {
      return {
        ok: true,
        credenciais: { pfxBuffer: creds.pfxBuffer, password: creds.password, cscId: null, cscToken: creds.cscToken },
      };
    }
  }

  const { data, error } = await supabase.functions.invoke<NfseCertificateFetchResponse>("nfse-certificate-fetch", {
    body: { unitId },
  });

  if (error || !data?.pfxBase64 || !data?.password) {
    const detail = await extrairDetalheErro(error ?? null);
    return { ok: false, motivo: `Certificado A1 não disponível: ${detail}` };
  }

  return {
    ok: true,
    credenciais: {
      pfxBuffer: Buffer.from(data.pfxBase64, "base64"),
      password: data.password,
      cscId: data.cscId ?? null,
      cscToken: data.cscToken ?? null,
    },
  };
}
