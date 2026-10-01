// deno test supabase/functions/crm-lifecycle-dispatch/variables.test.ts
import { type Candidate, type Kind, PREVIEW_LABEL, PURPOSE, variablesFor } from "./variables.ts";

function assertEquals(actual: unknown, expected: unknown, msg = "") {
  if (actual !== expected) throw new Error(`${msg} esperado ${expected}, veio ${actual}`);
}

const base = (kind: Kind, extra: Record<string, unknown> | null = null): Candidate => ({
  kind, category: "MARKETING", unit_id: null, guardian_id: "g", guardian_name: "Ana Paula Souza",
  phone_e164: "+5591900000000", child_first_name: "Miguel", activity: null, ref_key: "r", extra,
});

// Número de variáveis de cada template novo em crm-templates-bootstrap: o
// dispatcher pula o envio quando não bate.
const EXPECTED_COUNT: Partial<Record<Kind, number>> = {
  DEGRAU_2H: 2, DEGRAU_PORTO: 3, DEGRAU_DAYUSE: 2, CROSS_ATIVIDADE: 4, VIP: 2, WINBACK_1: 2, WINBACK_2: 2,
};

Deno.test("degraus e reescritos montam o número de variáveis do template", () => {
  const extras: Partial<Record<Kind, Record<string, unknown>>> = {
    DEGRAU_PORTO: { visits30d: 4 },
    CROSS_ATIVIDADE: { targetActivity: "CARRINHO" },
  };
  for (const [kind, count] of Object.entries(EXPECTED_COUNT)) {
    const vars = variablesFor(base(kind as Kind, extras[kind as Kind] ?? null), "https://g.page/r/x");
    assertEquals(vars ? Object.keys(vars).length : null, count, kind);
    assertEquals(vars?.["1"], "Ana", `${kind} {{1}}`);
  }
});

Deno.test("Porto Seguro leva o número de visitas e pula sem ele", () => {
  assertEquals(variablesFor(base("DEGRAU_PORTO", { visits30d: 5 }), "")?.["3"], "5");
  assertEquals(variablesFor(base("DEGRAU_PORTO", {}), ""), null);
});

Deno.test("convite cruzado nomeia e descreve a atividade", () => {
  const v = variablesFor(base("CROSS_ATIVIDADE", { targetActivity: "CARRINHO" }), "");
  assertEquals(v?.["3"], "o Circuito");
  assertEquals(variablesFor(base("CROSS_ATIVIDADE", { targetActivity: "X" }), ""), null);
});

Deno.test("todo kind tem purpose e rótulo", () => {
  for (const kind of Object.keys(PURPOSE) as Kind[]) {
    assertEquals(typeof PREVIEW_LABEL[kind], "string", kind);
  }
});
