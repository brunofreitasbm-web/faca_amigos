// Escopo de uma chamada ao crm-templates-bootstrap. Sem corpo, a function
// trata o catálogo inteiro (comportamento original). Com corpo JSON:
//   { "names": ["fa_nps_pos_visita_v2"] }  só estes templates (criar/submeter/ativar)
//   { "dryRun": true }                     só lista o que faria, sem tocar na Twilio, na Meta nem no banco
// Os dois podem vir juntos. Nome que não é do catálogo nem de fa_crm_templates
// é recusado (erro de digitação não pode virar "não fez nada" silencioso).

export type BootstrapScope =
  | { ok: true; names: Set<string> | null; dryRun: boolean }
  | { ok: false; error: string };

export function parseScope(raw: string, known: Set<string>): BootstrapScope {
  const text = raw.trim();
  if (!text) return { ok: true, names: null, dryRun: false };

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "corpo inválido: esperado JSON como {\"names\": [...], \"dryRun\": true}" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "corpo inválido: esperado um objeto JSON" };
  }
  const { names, dryRun } = body as { names?: unknown; dryRun?: unknown };

  if (dryRun !== undefined && typeof dryRun !== "boolean") {
    return { ok: false, error: "dryRun deve ser true ou false" };
  }

  let only: Set<string> | null = null;
  if (names !== undefined) {
    if (!Array.isArray(names) || names.length === 0 || names.some((n) => typeof n !== "string" || !n.trim())) {
      return { ok: false, error: "names deve ser uma lista não vazia de nomes de template" };
    }
    only = new Set(names.map((n) => (n as string).trim()));
    const unknown = [...only].filter((n) => !known.has(n));
    if (unknown.length > 0) {
      return { ok: false, error: `template(s) desconhecido(s): ${unknown.join(", ")}` };
    }
  }
  return { ok: true, names: only, dryRun: dryRun === true };
}
