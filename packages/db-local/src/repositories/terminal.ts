import { randomUUID } from "node:crypto";
import type { Db } from "../connection.js";

/**
 * Configuração da MÁQUINA, não da unidade: qual computador é este
 * (`device_id`) e a que unidade ele pertence (`terminal_unit_id`).
 *
 * Vive em `terminal_settings` (migration 0005) e não em `app_settings`
 * porque `app_settings.unit_id` tem FK para `units`, e a tabela `units`
 * local fica vazia em produção — gravar ali com unit_id 'global' sempre
 * estourou FOREIGN KEY constraint failed, em silêncio. Ver o cabeçalho
 * de 0005_terminal_settings.sql.
 */
export type TerminalSettingKey = "device_id" | "terminal_unit_id";

export function getTerminalSetting(db: Db, key: TerminalSettingKey): string | undefined {
  const row = db.prepare("SELECT value FROM terminal_settings WHERE key = ?").get(key) as { value: string } | undefined;
  const value = row?.value?.trim();
  return value ? value : undefined;
}

export function setTerminalSetting(db: Db, key: TerminalSettingKey, value: string, nowMs: number): void {
  db.prepare(
    `INSERT INTO terminal_settings (key, value, updated_at_ms) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms`,
  ).run(key, value, nowMs);
}

/**
 * Lê a configuração antiga em `app_settings`, para uma instalação que
 * porventura tenha conseguido gravar ali antes (ex.: máquina de
 * desenvolvimento, onde `seedDevData` popula `units` e a FK passa).
 * Só leitura: gravação nova vai sempre para `terminal_settings`.
 */
export function getLegacyAppSetting(db: Db, key: TerminalSettingKey): string | undefined {
  try {
    const scoped = db.prepare("SELECT value FROM app_settings WHERE unit_id = 'global' AND key = ?").get(key) as
      | { value: string }
      | undefined;
    if (scoped?.value?.trim()) return scoped.value.trim();

    const any = db.prepare("SELECT value FROM app_settings WHERE key = ? ORDER BY updated_at_ms DESC").get(key) as
      | { value: string }
      | undefined;
    return any?.value?.trim() || undefined;
  } catch {
    // app_settings pode não existir em um banco montado só para teste
    return undefined;
  }
}

/**
 * ID único e estável desta instalação. Gerado na primeira chamada e
 * persistido — o print bridge usa para saber quais jobs ele mesmo
 * emitiu, e o operador lê os primeiros caracteres na tela para
 * confirmar que os dois computadores são de fato distintos.
 */
export function ensureDeviceId(db: Db, nowMs: number): string {
  const existing = getTerminalSetting(db, "device_id") ?? getLegacyAppSetting(db, "device_id");
  if (existing) {
    if (!getTerminalSetting(db, "device_id")) setTerminalSetting(db, "device_id", existing, nowMs);
    return existing;
  }

  const deviceId = randomUUID();
  setTerminalSetting(db, "device_id", deviceId, nowMs);
  return getTerminalSetting(db, "device_id") ?? deviceId;
}

/** Unidade a que ESTE computador pertence, ou undefined se ainda não foi amarrado. */
export function getTerminalUnitId(db: Db): string | undefined {
  return getTerminalSetting(db, "terminal_unit_id") ?? getLegacyAppSetting(db, "terminal_unit_id");
}

export function setTerminalUnitId(db: Db, unitId: string, nowMs: number): void {
  setTerminalSetting(db, "terminal_unit_id", unitId.trim(), nowMs);
}
