import { safeStorage } from "electron";
import type { CofreCrypto } from "./vault.js";

/**
 * Implementação real de `CofreCrypto` usando `safeStorage` do Electron —
 * DPAPI no Windows, atrelada à conta do usuário logado. É por isso que
 * copiar a pasta do cofre para outro PC não funciona: o certificado
 * precisa ser reinstalado ali, com a senha digitada de novo. Proposital.
 *
 * Único arquivo desta pasta que importa `electron` — isolado assim para
 * vault.ts continuar testável em Node puro (Vitest não roda dentro do
 * Electron).
 */
export function electronSafeStorageCrypto(): CofreCrypto {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "safeStorage indisponível neste sistema — sem cofre seguro para a senha do certificado, " +
        "a instalação fiscal não pode continuar.",
    );
  }
  return {
    encrypt: (plainText: string) => safeStorage.encryptString(plainText),
    decrypt: (cipherText: Buffer) => safeStorage.decryptString(cipherText),
  };
}
