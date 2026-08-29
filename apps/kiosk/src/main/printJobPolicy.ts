import { getTerminalSetting, getLegacyAppSetting, ensureDeviceId, type Db } from "@facaamigos/db-local";

export interface PrintJobRow {
  id: string;
  unit_id: string;
  kind: "WRISTBAND" | "RECEIPT";
  payload_json: Record<string, unknown>;
  status?: string;
  origin_device_id?: string | null;
}

function splitUnitList(raw: string | undefined | null, into: Set<string>): void {
  if (!raw) return;
  for (const id of raw.split(",")) {
    const trimmed = id.trim().toLowerCase();
    if (trimmed) into.add(trimmed);
  }
}

/**
 * Unidades cujos jobs ESTE terminal pode imprimir.
 *
 * Conjunto vazio significa "terminal ainda não amarrado" e, desde a
 * correção, é tratado como "não imprime nada" — antes era tratado como
 * "imprime tudo", que é literalmente o bug: os dois computadores,
 * nenhum deles amarrado, imprimiam os jobs um do outro.
 *
 * Sempre em minúsculas: o filtro do Realtime e o claim no Postgres
 * comparam o unit_id como texto, e um UUID em maiúsculas casaria num e
 * não casaria no outro.
 */
export function getTerminalUnitIds(db?: Db): Set<string> {
  const allowed = new Set<string>();

  splitUnitList(process.env.FACAAMIGOS_UNIT_ID ?? process.env.UNIT_ID, allowed);

  if (db) {
    try {
      splitUnitList(getTerminalSetting(db, "terminal_unit_id") ?? getLegacyAppSetting(db, "terminal_unit_id"), allowed);
    } catch {
      // terminal_settings pode não existir em um banco montado só para teste
    }
  }

  return allowed;
}

/** ID desta instalação; null quando não há banco local e nem env var. */
export function getLocalDeviceId(db?: Db): string | null {
  if (db) {
    try {
      return ensureDeviceId(db, Date.now());
    } catch {
      // fallback
    }
  }
  return process.env.FACAAMIGOS_DEVICE_ID ?? process.env.DEVICE_ID ?? null;
}

export interface JobDecision {
  accept: boolean;
  reason?: string;
}

/**
 * Decide se este terminal sequer considera o job. É um pré-filtro
 * barato: quem garante impressão única é a reserva atômica no Postgres
 * (fa_kiosk_claim_print_job). Fail-closed em todos os casos duvidosos.
 */
export function shouldConsiderJob(input: {
  job: Pick<PrintJobRow, "id" | "unit_id">;
  allowedUnits: Set<string>;
  deviceId: string | null;
}): JobDecision {
  const { job, allowedUnits, deviceId } = input;

  if (allowedUnits.size === 0) {
    return {
      accept: false,
      reason: `terminal sem unidade amarrada (Configurações > Impressoras > Este terminal) — job ${job.id} ignorado`,
    };
  }

  if (!deviceId) {
    return { accept: false, reason: `terminal sem device_id — job ${job.id} ignorado` };
  }

  const unitId = (job.unit_id ?? "").toLowerCase();
  if (!allowedUnits.has(unitId)) {
    return {
      accept: false,
      reason: `job ${job.id} é da unidade ${job.unit_id}; este terminal é de ${Array.from(allowedUnits).join(", ")}`,
    };
  }

  return { accept: true };
}

export function isVirtualOrPdfPrinter(deviceName: string): boolean {
  const lower = deviceName.toLowerCase();
  return lower.includes("pdf") || lower.includes("xps") || lower.includes("virtual") || lower.includes("fax") || lower.includes("onenote");
}

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export interface PrinterMatch {
  name: string | null;
  /** Preenchido quando a escolha merece aviso no log (match frouxo ou fallback). */
  warning?: string;
}

/**
 * Traduz o nome configurado para o nome exato de uma impressora
 * instalada neste Windows.
 *
 * A versão anterior aceitava substring nos DOIS sentidos
 * (`n.includes(cfg) || cfg.includes(n)`), o que casa "POS-80" com
 * "POS-80 (Cópia 1)" — com as duas unidades usando o mesmo modelo
 * térmico, era assim que o job da unidade errada achava impressora e
 * imprimia. Agora substring só vale quando UMA única instalada casa, e
 * ainda assim com aviso.
 */
export function resolvePrinterName(configured: string | null | undefined, installedNames: string[]): PrinterMatch {
  const trimmed = configured?.trim() ?? "";

  if (trimmed) {
    const exact = installedNames.find((n) => n === trimmed);
    if (exact) return { name: exact };

    const normalized = installedNames.filter((n) => normalize(n) === normalize(trimmed));
    if (normalized.length === 1) return { name: normalized[0]! };

    const partial = installedNames.filter((n) => normalize(n).includes(normalize(trimmed)) || normalize(trimmed).includes(normalize(n)));
    if (partial.length === 1) {
      return {
        name: partial[0]!,
        warning: `Impressora "${trimmed}" não existe com esse nome exato; usando "${partial[0]}", a única parecida instalada.`,
      };
    }
    if (partial.length > 1) {
      return {
        name: null,
        warning: `Impressora "${trimmed}" casa com mais de uma instalada (${partial.join(", ")}) — nome ambíguo, nada será impresso até corrigir em Configurações > Impressoras.`,
      };
    }

    return { name: null, warning: `Impressora "${trimmed}" não foi encontrada neste terminal.` };
  }

  // Nenhuma impressora configurada: primeira física instalada. Só é
  // alcançável para a PRÓPRIA unidade do terminal (a guarda de unidade
  // roda antes), então serve de "funciona de primeira" numa instalação
  // nova sem risco de imprimir job de outra unidade.
  const physical = installedNames.find((n) => !isVirtualOrPdfPrinter(n));
  const fallback = physical ?? installedNames[0] ?? null;
  if (!fallback) return { name: null, warning: "Nenhuma impressora instalada encontrada neste terminal." };

  return {
    name: fallback,
    warning: `Nenhuma impressora configurada para esta unidade; usando "${fallback}". Escolha a correta em Configurações > Impressoras.`,
  };
}

/** Só o que o claim precisa do cliente Supabase — mantém a função testável sem Electron. */
export interface ClaimRpcClient {
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export const CLAIM_BATCH_LIMIT = 10;

/**
 * Reserva no Postgres os próximos jobs desta unidade. É a reserva — e
 * não o filtro em TypeScript — que garante que um job seja impresso uma
 * única vez, por mais terminais que estejam escutando a tabela.
 *
 * Devolve [] quando o terminal não está amarrado ou não tem device_id:
 * fail-closed, para um terminal mal configurado ficar mudo em vez de
 * imprimir job das outras unidades.
 */
export async function claimPrintJobs(
  client: ClaimRpcClient,
  unitIds: string[],
  deviceId: string | null,
  limit = CLAIM_BATCH_LIMIT,
): Promise<PrintJobRow[]> {
  if (unitIds.length === 0 || !deviceId) return [];

  const { data, error } = await client.rpc("fa_kiosk_claim_print_jobs", {
    p_device_id: deviceId,
    p_unit_ids: unitIds,
    p_limit: limit,
  });
  if (error) {
    console.error("[print-bridge] falha ao reservar jobs de impressão:", error.message);
    return [];
  }
  return (data ?? []) as PrintJobRow[];
}

/**
 * Reserva um job específico (caminho do evento Realtime). `null`
 * significa que outro terminal já é o dono — este não deve imprimir.
 */
export async function claimPrintJob(
  client: ClaimRpcClient,
  jobId: string,
  unitIds: string[],
  deviceId: string | null,
): Promise<PrintJobRow | null> {
  if (unitIds.length === 0 || !deviceId) return null;

  const { data, error } = await client.rpc("fa_kiosk_claim_print_job", {
    p_job_id: jobId,
    p_device_id: deviceId,
    p_unit_ids: unitIds,
  });
  if (error) {
    console.error(`[print-bridge] falha ao reservar o job ${jobId}:`, error.message);
    return null;
  }
  return (data as PrintJobRow | null) ?? null;
}
