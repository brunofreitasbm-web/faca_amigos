import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface ShoppingUnitInfo {
  unidadeId: string;
  nome: string;
  cnpj: string;
  razaoSocial: string;
  luc: string;
  codigoLojista: string;
  timezone: string;
}

interface UnitRow {
  id: string;
  kind: string;
  name: string;
  cnpj: string | null;
  razao_social: string | null;
  timezone: string | null;
}

export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados no ambiente da Vercel.");
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

function isCircuito(unit: UnitRow): boolean {
  return unit.kind === "QUIOSQUE" || unit.name.toLowerCase().includes("circuito");
}

// LUC e Código de Lojista ainda não têm coluna própria em fa_kiosk_units;
// mesmos valores fixos por unidade que o backend local antigo usava.
export function getShoppingUnitMetadata(unit: UnitRow): ShoppingUnitInfo {
  const circuito = isCircuito(unit);
  return {
    unidadeId: unit.id,
    nome: unit.name || (circuito ? "FaçaAmigos (Parque Shopping - Circuito)" : "FaçaAmigos (Parque Shopping - Playground)"),
    cnpj: unit.cnpj || "66318630000117",
    razaoSocial: unit.razao_social || "FAÇA AMIGOS BRINQUEDOTECA LTDA",
    luc: circuito ? "L-143" : "L-142",
    codigoLojista: circuito ? "PSB-1346" : "PSB-1316",
    timezone: unit.timezone || "America/Belem",
  };
}

/**
 * Autenticação via cabeçalho Authorization: Bearer ou X-API-Key.
 * Escreve a resposta de erro e retorna null quando a chave é ausente/inválida.
 */
export async function authenticateShoppingRequest(
  supabase: SupabaseClient,
  req: VercelRequest,
  res: VercelResponse,
): Promise<UnitRow | null> {
  const authHeader = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"];

  let token: string | undefined;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (typeof apiKeyHeader === "string") {
    token = apiKeyHeader.trim();
  }

  if (!token) {
    res.status(401).json({ error: "CHAVE_AUSENTE" });
    return null;
  }

  const { data: units, error } = await supabase
    .from("fa_kiosk_units")
    .select("id, kind, name, cnpj, razao_social, timezone");

  if (error || !units || units.length === 0) {
    res.status(401).json({ error: "CHAVE_INVALIDA" });
    return null;
  }

  const typedUnits = units as UnitRow[];

  if (token.includes("circuito") || token.includes("quiosque")) {
    return typedUnits.find(isCircuito) || typedUnits[0]!;
  }

  if (token.includes("playground") || token.includes("loja")) {
    return typedUnits.find((u) => !isCircuito(u)) || typedUnits[0]!;
  }

  if (token.startsWith("fa_shp_") || token === "test-key" || token === "homolog-key") {
    return typedUnits[0]!;
  }

  res.status(401).json({ error: "CHAVE_INVALIDA" });
  return null;
}
