import { type UnitOption, unitListText } from "./nps.ts";

/**
 * Montagem da pesquisa de NPS no envio (crm-nps-send e crm-nps-auto-dispatch).
 *
 * O template novo (`fa_nps_pos_visita_v2`) pergunta a unidade e leva a lista
 * numerada em {{2}}. O template antigo (só {{1}}) já abre pedindo a nota 0-10:
 * com ele não há pergunta de unidade, então unit_options fica nulo e o
 * webhook começa direto na nota. Assim os dois convivem até a Meta aprovar o v2.
 */
export const templateAsksUnit = (preview: string): boolean => /\{\{2\}\}/.test(preview);

/** Unidades na ordem estável de criação; o número digitado pelo responsável aponta para esta lista. */
// deno-lint-ignore no-explicit-any
export async function loadUnitOptions(admin: { from(table: string): any }): Promise<UnitOption[]> {
  const { data } = await admin.from("fa_kiosk_units").select("id, name").order("created_at", { ascending: true });
  return (data ?? []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }));
}

export function npsVariables(firstName: string, unitOptions: UnitOption[] | null): Record<string, string> {
  return unitOptions ? { "1": firstName, "2": unitListText(unitOptions) } : { "1": firstName };
}

export function renderNpsPreview(preview: string, firstName: string, unitOptions: UnitOption[] | null): string {
  return preview
    .replace(/\{\{1\}\}/g, firstName)
    .replace(/\{\{2\}\}/g, unitOptions ? unitListText(unitOptions) : "");
}
