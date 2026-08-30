import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

// Sem geração de tipos a partir do schema Postgres ainda (Fase 0 recém
// escrita, não aplicada) — usamos `any` no generic do schema para não
// travar o typecheck em `never` até existir um `Database` gerado.
let client: SupabaseClient<any, any, any> | null = null;

const DEFAULT_SUPABASE_URL = "https://ivjvpdzsfjdpyabbzzuj.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ssGb6CGSjsE7PTfXpR6cBg_I20V6YBh";

/** Mesmo projeto Supabase usado por apps/backoffice (ver seu src/lib/supabase/client.ts). */
export function supabase(): SupabaseClient<any, any, any> {
  if (!client) {
    const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_SUPABASE_URL;
    const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
    client = createSupabaseClient<any, any, any>(url, key);
  }
  return client;
}
