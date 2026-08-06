import { randomBytes } from "node:crypto";

/**
 * UUID v7 (D6 do plano): ordenável por tempo de criação, gerado no
 * cliente sem esperar round-trip com o servidor — essencial para
 * operar offline. Layout: 48 bits de epoch ms + versão 7 + variante
 * RFC 4122 + 74 bits de aleatoriedade.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const rand = randomBytes(10);

  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(nowMs % 2 ** 48, 0, 6);

  bytes[6] = 0x70 | (rand[0]! & 0x0f); // versão 7
  bytes[7] = rand[1]!;
  bytes[8] = 0x80 | (rand[2]! & 0x3f); // variante RFC 4122
  rand.copy(bytes, 9, 3, 10);

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
