import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Chave de acesso para integrações externas (a administração do
 * shopping é a primeira). Mesmo esquema do PIN (scrypt via
 * node:crypto, ver security/pin.ts) pelo mesmo motivo: sem dependência
 * nativa para quebrar o empacotamento do Electron.
 *
 * Formato: `fa_shp_<prefixo 8 hex>_<segredo 48 hex>`.
 *
 * O prefixo é público e serve para duas coisas: localizar a linha no
 * banco em uma consulta indexada (sem varrer a tabela testando hash) e
 * dar ao humano um jeito de reconhecer a chave no painel — "a que
 * termina em 3f2a foi revogada" é uma frase que precisa fazer sentido
 * numa ligação com o suporte do shopping. O segredo aparece uma única
 * vez, na criação; depois disso só existe o hash.
 */

const PREFIXO_MARCA = "fa_shp";

export interface ChaveGerada {
  /** Valor completo. É a única vez que ele existe em claro — entregar e esquecer. */
  segredo: string;
  prefixo: string;
  hash: string;
}

export function gerarChaveApi(): ChaveGerada {
  const prefixo = randomBytes(4).toString("hex");
  const segredoBruto = randomBytes(24).toString("hex");
  const segredo = `${PREFIXO_MARCA}_${prefixo}_${segredoBruto}`;
  return { segredo, prefixo, hash: hashChaveApi(segredo) };
}

export function hashChaveApi(segredo: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(segredo, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verificarChaveApi(segredo: string, armazenado: string): boolean {
  const [saltHex, hashHex] = armazenado.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const esperado = Buffer.from(hashHex, "hex");
  const atual = scryptSync(segredo, salt, 64);
  return atual.length === esperado.length && timingSafeEqual(atual, esperado);
}

/** Extrai o prefixo sem confiar no conteúdo: chave malformada devolve null e vira 401, não exceção. */
export function extrairPrefixo(segredo: string): string | null {
  const partes = segredo.split("_");
  if (partes.length !== 4) return null;
  const [marca, tipo, prefixo, resto] = partes;
  if (`${marca}_${tipo}` !== PREFIXO_MARCA) return null;
  if (!prefixo || !resto) return null;
  return prefixo;
}

/**
 * Aceita `Authorization: Bearer <chave>` e `X-API-Key: <chave>`.
 * Suportar os dois não é indecisão: não sabemos ainda qual o sistema
 * do shopping consegue emitir, e descobrir isso só na virada de mês
 * sairia caro.
 */
export function extrairChaveDoRequest(headers: Record<string, unknown>): string | null {
  const authorization = headers["authorization"];
  if (typeof authorization === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1]!.trim();
  }
  const apiKey = headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();
  return null;
}
