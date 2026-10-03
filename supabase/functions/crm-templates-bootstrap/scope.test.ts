// deno test supabase/functions/crm-templates-bootstrap/scope.test.ts
import { parseScope } from "./scope.ts";

function assertEquals(actual: unknown, expected: unknown, msg = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg} esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`);
  }
}

const known = new Set(["fa_nps_pos_visita_v2", "fa_nps_pos_visita", "fa_oferta_vip_v2"]);
const view = (s: ReturnType<typeof parseScope>) => (s.ok ? { ok: true, names: s.names ? [...s.names] : null, dryRun: s.dryRun } : s);

Deno.test("sem corpo: catálogo inteiro, como antes", () => {
  assertEquals(view(parseScope("", known)), { ok: true, names: null, dryRun: false });
  assertEquals(view(parseScope("  \n", known)), { ok: true, names: null, dryRun: false });
});

Deno.test("names limita o escopo", () => {
  assertEquals(view(parseScope('{"names":["fa_nps_pos_visita_v2"]}', known)), { ok: true, names: ["fa_nps_pos_visita_v2"], dryRun: false });
  assertEquals(view(parseScope('{"names":[" fa_nps_pos_visita_v2 ","fa_nps_pos_visita_v2"]}', known)), { ok: true, names: ["fa_nps_pos_visita_v2"], dryRun: false });
});

Deno.test("dryRun sozinho ou junto com names", () => {
  assertEquals(view(parseScope('{"dryRun":true}', known)), { ok: true, names: null, dryRun: true });
  assertEquals(view(parseScope('{"names":["fa_oferta_vip_v2"],"dryRun":true}', known)), { ok: true, names: ["fa_oferta_vip_v2"], dryRun: true });
  assertEquals(view(parseScope('{"dryRun":false}', known)), { ok: true, names: null, dryRun: false });
});

Deno.test("nome desconhecido ou formato errado é recusado", () => {
  assertEquals(parseScope('{"names":["fa_nps_pos_visita_v3"]}', known).ok, false);
  assertEquals(parseScope('{"names":[]}', known).ok, false, "lista vazia não pode virar 'tudo'");
  assertEquals(parseScope('{"names":"fa_nps_pos_visita_v2"}', known).ok, false);
  assertEquals(parseScope('{"names":[1]}', known).ok, false);
  assertEquals(parseScope('{"dryRun":"sim"}', known).ok, false);
  assertEquals(parseScope("[]", known).ok, false);
  assertEquals(parseScope("nao-e-json", known).ok, false);
});
