import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { classifyTerminalKey } from "./supabaseTerminalKey.js";

// A chave do terminal vive em %APPDATA%\FacaAmigos\.env (fora da pasta de
// instalação, então o NSIS não apaga em atualização). O que SUMIA era a chave
// colada em .env dentro da instalação (resources/ ou ao lado do .exe): cada
// atualização reinstala essa pasta e o arquivo vai embora, e o aviso do print
// bridge volta. Estas funções movem a chave para o .env do userData.

const VAR_CHAVE = "FACAAMIGOS_SUPABASE_SECRET_KEY";

/** Troca (ou acrescenta) `nome=valor` no texto de um .env, preservando o resto. */
export function upsertEnvVar(content: string, nome: string, valor: string): string {
  const linhas = content.split(/\r?\n/);
  let achou = false;
  const saida = linhas.map((linha) => {
    const t = linha.trim();
    if (!t.startsWith("#") && t.slice(0, t.indexOf("=")).trim() === nome) {
      achou = true;
      return `${nome}=${valor}`;
    }
    return linha;
  });
  if (!achou) {
    if (saida.length && saida[saida.length - 1] === "") saida.pop();
    saida.push(`${nome}=${valor}`, "");
  }
  return saida.join("\n");
}

/** Valor da variável no .env, ou "" se ausente. */
export function readEnvVar(content: string, nome: string): string {
  for (const bruta of content.split(/\r?\n/)) {
    const t = bruta.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0 && t.slice(0, eq).trim() === nome) return t.slice(eq + 1).trim();
  }
  return "";
}

/** Chave que serve como credencial de terminal (secreta nova ou JWT legado). */
export function isUsableTerminalKey(value: string | undefined | null): boolean {
  const k = classifyTerminalKey(value);
  return k === "secret" || k === "legacy-jwt";
}

/**
 * Grava a chave no .env indicado (cria o arquivo se preciso).
 * Retorna false se o valor não for uma chave utilizável ou se já estiver gravado.
 */
export function persistTerminalKey(envPath: string, key: string): boolean {
  const valor = key.trim();
  if (!isUsableTerminalKey(valor)) return false;
  const atual = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  if (readEnvVar(atual, VAR_CHAVE) === valor) return false;
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, upsertEnvVar(atual, VAR_CHAVE, valor), "utf8");
  return true;
}
