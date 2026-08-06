import { supabase } from "./client.js";

/**
 * Troca rápida de operador (Fase 1 da migração para Supabase): o PIN
 * NUNCA autentica sozinho — ele só decide qual sessão real (já obtida por
 * e-mail/senha em algum login anterior neste terminal) reativar via
 * `auth.refreshSession`. Isso preserva `auth.uid()` correto em todo
 * registro de audit_log/ponto_records, ao contrário do PIN-only local de
 * antes, onde qualquer terminal podia alegar ser qualquer funcionário.
 */

const STORAGE_KEY = "fa_kiosk_terminal_employees";

interface CachedEmployee {
  employeeId: string;
  fullName: string;
  role: "OPERADOR" | "GERENTE" | "ADMIN";
  refreshToken: string;
  pinSalt: string;
  pinHash: string;
}

/** Mesmo shape do antigo `Employee` de api/client.ts, para não exigir mudanças nas telas. */
export interface TerminalEmployee {
  id: string;
  full_name: string;
  role: "OPERADOR" | "GERENTE" | "ADMIN";
}

function readCache(): CachedEmployee[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as CachedEmployee[];
  } catch {
    return [];
  }
}

function writeCache(entries: CachedEmployee[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

async function hashPin(pin: string, saltHex: string): Promise<string> {
  const data = new TextEncoder().encode(`${saltHex}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSalt(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function listTerminalEmployees(): TerminalEmployee[] {
  return readCache().map(({ employeeId, fullName, role }) => ({ id: employeeId, full_name: fullName, role }));
}

export function forgetTerminalEmployee(employeeId: string) {
  writeCache(readCache().filter((e) => e.employeeId !== employeeId));
}

/** Primeiro login de um funcionário neste terminal: e-mail/senha reais + escolha de PIN. */
export async function fullLogin(email: string, password: string, pin: string): Promise<TerminalEmployee> {
  const { data, error } = await supabase().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message ?? "Falha no login");

  const { data: employeeRow, error: employeeError } = await supabase()
    .from("fa_kiosk_employees")
    .select("id, full_name, role")
    .eq("auth_user_id", data.session.user.id)
    .single();
  if (employeeError || !employeeRow) throw new Error("Conta sem funcionário vinculado em fa_kiosk_employees");

  const pinSalt = randomSalt();
  const pinHash = await hashPin(pin, pinSalt);
  const entry: CachedEmployee = {
    employeeId: employeeRow.id as string,
    fullName: employeeRow.full_name as string,
    role: employeeRow.role as CachedEmployee["role"],
    refreshToken: data.session.refresh_token,
    pinSalt,
    pinHash,
  };
  writeCache([...readCache().filter((e) => e.employeeId !== entry.employeeId), entry]);
  return { id: entry.employeeId, full_name: entry.fullName, role: entry.role };
}

/** Troca rápida: reativa a sessão real já obtida no primeiro login, sem novo e-mail/senha. */
export async function quickSwitch(employeeId: string, pin: string): Promise<TerminalEmployee> {
  const cache = readCache();
  const entry = cache.find((e) => e.employeeId === employeeId);
  if (!entry) throw new Error("Funcionário não tem login salvo neste terminal");

  const candidateHash = await hashPin(pin, entry.pinSalt);
  if (candidateHash !== entry.pinHash) throw new Error("PIN incorreto");

  const { data, error } = await supabase().auth.refreshSession({ refresh_token: entry.refreshToken });
  if (error || !data.session) throw new Error("Sessão expirada — faça login novamente com e-mail e senha");

  entry.refreshToken = data.session.refresh_token;
  writeCache(cache);
  return { id: entry.employeeId, full_name: entry.fullName, role: entry.role };
}
