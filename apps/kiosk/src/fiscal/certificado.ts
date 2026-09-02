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
 * IMPORTANTE: o `Authorization` vem do cliente, configurado em
 * `global.headers` na criação dele (ver fiscal/index.ts) — e isso é
 * OBRIGATÓRIO, não decorativo.
 *
 * O comentário que estava aqui afirmava o contrário: que o
 * `supabase.functions.invoke` já mandava a `secretKey` como bearer sozinho
 * e que um header manual "quebraria a autorização". É falso em
 * @supabase/supabase-js 2.112.1: o invoke manda `apikey: <secretKey>`, mas
 * deriva o bearer da sessão do usuário — que num worker headless não
 * existe — e o header sai literalmente `Authorization: undefined`. A
 * função então compara "undefined" com o segredo e devolve 401.
 *
 * Essa crença custou o diagnóstico inteiro: como o 401 aparecia como
 * "Certificado A1 não disponível: não autorizado", a investigação foi
 * atrás de chave errada, secret ausente e .env envenenado — enquanto a
 * chave estava certa e nunca chegava a ser enviada.
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
    // "não autorizado" nunca é sobre o certificado em si (ele já foi
    // encontrado no banco quando a function chega nesse ponto) — é sempre a
    // chave FACAAMIGOS_SUPABASE_SECRET_KEY deste terminal não batendo com o
    // segredo configurado na Edge Function (SUPABASE_SERVICE_ROLE_KEY ou
    // FISCAL_WORKER_SECRET_KEY). Deixa isso explícito pra não parecer
    // problema de upload/configuração do certificado.
    //
    // A dica ANTIGA aqui mandava usar a service_role legada (eyJ...) e
    // dizia que ela "funciona sempre". Não funciona: medido contra o
    // projeto de produção em 2026-09-02, o JWT legado responde 401 nesta
    // function, porque num projeto migrado para as chaves novas o
    // SUPABASE_SERVICE_ROLE_KEY que o runtime injeta já é `sb_secret_...`.
    // Seguir aquela dica garantia o erro em vez de resolvê-lo.
    const dica =
      detail === "não autorizado"
        ? " (a chave deste terminal não é aceita: FACAAMIGOS_SUPABASE_SECRET_KEY no .env precisa ser a chave secreta NOVA, sb_secret_..., e o mesmo valor precisa estar no secret FISCAL_WORKER_SECRET_KEY do projeto. A service_role legada eyJ... NÃO serve aqui)"
        : "";
    return { ok: false, motivo: `Certificado A1 não disponível: ${detail}${dica}` };
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
