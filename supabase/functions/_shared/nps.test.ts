// deno test supabase/functions/_shared/nps.test.ts
import { isDecline, npsStep, NPS_TEXT, parseNumberInRange, unitListText, unitOptions } from "./nps.ts";

function assertEquals(actual: unknown, expected: unknown, msg = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg} esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`);
  }
}

Deno.test("número sozinho dentro da faixa", () => {
  assertEquals(parseNumberInRange("9", 0, 10), { kind: "ok", value: 9 });
  assertEquals(parseNumberInRange(" 10 ", 0, 10), { kind: "ok", value: 10 });
  assertEquals(parseNumberInRange("0", 0, 10), { kind: "ok", value: 0 });
  assertEquals(parseNumberInRange("3)", 1, 5), { kind: "ok", value: 3 });
  assertEquals(parseNumberInRange("4.", 1, 5), { kind: "ok", value: 4 });
});

Deno.test("palavra-chave libera mensagem curta", () => {
  assertEquals(parseNumberInRange("nota 8", 0, 10), { kind: "ok", value: 8 });
  assertEquals(parseNumberInRange("Unidade 2", 1, 3), { kind: "ok", value: 2 });
  assertEquals(parseNumberInRange("opção 3", 1, 3), { kind: "ok", value: 3 });
});

Deno.test("só número sozinho fora da faixa pede de novo", () => {
  assertEquals(parseNumberInRange("7", 1, 5), { kind: "out" });
  assertEquals(parseNumberInRange("11", 0, 10), { kind: "out" });
  assertEquals(parseNumberInRange("0", 1, 5), { kind: "out" });
  assertEquals(parseNumberInRange("4", 1, 3), { kind: "out" });
});

Deno.test("texto livre ou vários números não são resposta", () => {
  assertEquals(parseNumberInRange("tenho 2 filhos", 0, 10), { kind: "none" });
  assertEquals(parseNumberInRange("nota 9 e 10", 0, 10), { kind: "none" });
  assertEquals(parseNumberInRange("gostei muito", 0, 10), { kind: "none" });
  assertEquals(parseNumberInRange("nota 7", 1, 5), { kind: "none" });
  assertEquals(parseNumberInRange("", 0, 10), { kind: "none" });
});

Deno.test("recusa da contribuição", () => {
  assertEquals(isDecline("Não"), true);
  assertEquals(isDecline("não, obrigada!"), true);
  assertEquals(isDecline("não gostei do banheiro"), false);
  assertEquals(isDecline("Não obrigado"), true);
  assertEquals(isDecline("N"), true);
  assertEquals(isDecline("Nada."), true);
  assertEquals(isDecline("a recepção foi ótima"), false);
});

Deno.test("etapa em aberto pelo estado da pesquisa", () => {
  const opts = [{ id: "a", name: "A" }];
  assertEquals(npsStep({ status: "SENT", unit_id: null, unit_options: opts, score_team: null }), "UNIT");
  assertEquals(npsStep({ status: "SENT", unit_id: "a", unit_options: opts, score_team: null }), "SCORE");
  assertEquals(npsStep({ status: "SENT", unit_id: null, unit_options: null, score_team: null }), "SCORE", "template antigo");
  assertEquals(npsStep({ status: "ASKING", unit_id: "a", unit_options: opts, score_team: null }), "TEAM");
  assertEquals(npsStep({ status: "ASKING", unit_id: null, unit_options: opts, score_team: null }), "UNIT", "template antigo: unidade depois da nota");
  assertEquals(npsStep({ status: "ASKING", unit_id: null, unit_options: null, score_team: null }), "TEAM", "sem unidades cadastradas");
  assertEquals(npsStep({ status: "ASKING", unit_id: "a", unit_options: opts, score_team: 4 }), "SPACE");
  assertEquals(npsStep({ status: "SCORED", unit_id: null, unit_options: null, score_team: null }), "COMMENT");
  assertEquals(npsStep({ status: "DONE", unit_id: null, unit_options: null, score_team: null }), null);
});

Deno.test("lista de unidades e opções inválidas", () => {
  assertEquals(unitListText([{ id: "a", name: "Playground" }, { id: "b", name: "Circuito" }]), "1) Playground · 2) Circuito");
  assertEquals(unitOptions([{ id: "a", name: "X" }, { id: 1 }, null]), [{ id: "a", name: "X" }]);
  assertEquals(unitOptions(null), []);
  assertEquals(NPS_TEXT.scoreQuestion("Circuito").includes("Circuito"), true);
  assertEquals(NPS_TEXT.commentQuestion(10) !== NPS_TEXT.commentQuestion(3), true);
});
