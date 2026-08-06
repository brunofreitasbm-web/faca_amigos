import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * PIN hasheado com scrypt (não Argon2id como o plano descreve na
 * seção 7.1): `argon2` é um módulo nativo e sofreria o mesmo problema
 * já comprovado nesta máquina com `better-sqlite3` — sem prebuild
 * para Node 24 e sem Visual Studio Build Tools instalado, a instalação
 * quebra. `scrypt` é nativo do runtime (node:crypto), memory-hard e
 * adequado para PIN/senha. Revisitar se uma toolchain de build
 * confiável existir no parque de máquinas de produção.
 */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
