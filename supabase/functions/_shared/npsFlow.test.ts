// deno test supabase/functions/_shared/npsFlow.test.ts
import { handleNps } from "./npsFlow.ts";
import { NPS_TEXT } from "./nps.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function assertEquals(actual: unknown, expected: unknown, msg = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg} esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`);
  }
}

/** Client falso do Supabase só com o que handleNps usa, sobre linhas em memória. */
function fakeAdmin(rows: Row[], units: Row[] = [], tables: Record<string, Row[]> = {}) {
  return {
    from(table: string) {
      if (table === "fa_kiosk_units") {
        // deno-lint-ignore no-explicit-any
        const u: any = {
          select: () => u,
          order: () => u,
          // deno-lint-ignore no-explicit-any
          then: (resolve: (v: any) => void) => resolve({ data: units }),
        };
        return u;
      }
      const data = tables[table] ?? rows;
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let returning = false;
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select() {
          if (patch) returning = true;
          return b;
        },
        update(p: Row) {
          patch = p;
          return b;
        },
        eq(k: string, v: unknown) {
          filters.push((r) => r[k] === v);
          return b;
        },
        lte(k: string, v: number) {
          filters.push((r) => r[k] <= v);
          return b;
        },
        is(k: string, v: unknown) {
          filters.push((r) => (r[k] ?? null) === v);
          return b;
        },
        in(k: string, vs: unknown[]) {
          filters.push((r) => vs.includes(r[k]));
          return b;
        },
        order() {
          return b;
        },
        limit() {
          return b;
        },
        maybeSingle() {
          const m = data.filter((r) => filters.every((f) => f(r))).sort((x, y) => (y.sent_at_ms ?? y.checkout_at_ms) - (x.sent_at_ms ?? x.checkout_at_ms));
          return Promise.resolve({ data: m[0] ? { ...m[0] } : null });
        },
        // deno-lint-ignore no-explicit-any
        then(resolve: (v: any) => void) {
          const m = data.filter((r) => filters.every((f) => f(r)));
          if (patch) m.forEach((r) => Object.assign(r, patch));
          resolve({ data: returning ? m.map((r) => ({ id: r.id })) : null });
        },
      };
      return b;
    },
  };
}

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const UNITS = [
  { id: "u1", name: "Playground Bosque" },
  { id: "u2", name: "Playground Parque" },
  { id: "u3", name: "Circuito Parque" },
];
const survey = (over: Row = {}): Row => ({
  id: "s1", contact_id: "c1", status: "SENT", sent_at_ms: NOW - 3 * 60 * MIN, last_step_ms: null,
  scored_at_ms: null, score: null, score_team: null, score_space: null, unit_id: null, unit_options: UNITS,
  feedback: null, ...over,
});

Deno.test("conversa completa: unidade, nota, equipe, espaço e contribuição", async () => {
  const rows = [survey()];
  const admin = fakeAdmin(rows);
  const say = (body: string, at = NOW) => handleNps(admin, "c1", body, at);

  assertEquals(await say("oi, tudo bem?"), null, "texto livre não é resposta");
  assertEquals(await say("4"), NPS_TEXT.retryUnit(UNITS), "unidade fora da lista");
  assertEquals(rows[0].unit_id, null);

  assertEquals(await say("2", NOW + MIN), NPS_TEXT.scoreQuestion("Playground Parque"));
  assertEquals(rows[0].unit_id, "u2");
  assertEquals(rows[0].status, "SENT");

  assertEquals(await say("9", NOW + 2 * MIN), NPS_TEXT.teamQuestion);
  assertEquals([rows[0].status, rows[0].score], ["ASKING", 9]);

  assertEquals(await say("7", NOW + 3 * MIN), NPS_TEXT.retryFive, "7 fora da escala 1-5");
  assertEquals(await say("5", NOW + 3 * MIN), NPS_TEXT.spaceQuestion);
  assertEquals(rows[0].score_team, 5);

  assertEquals(await say("4", NOW + 4 * MIN), NPS_TEXT.commentQuestion(9));
  assertEquals([rows[0].status, rows[0].score_space, rows[0].scored_at_ms], ["SCORED", 4, NOW + 4 * MIN]);

  assertEquals(await say("O espaço é lindo e a equipe é ótima", NOW + 5 * MIN), NPS_TEXT.thanks);
  assertEquals([rows[0].status, rows[0].feedback], ["DONE", "O espaço é lindo e a equipe é ótima"]);
  assertEquals(await say("obrigada!", NOW + 6 * MIN), null, "pesquisa encerrada: volta a ser conversa normal");
});

Deno.test("template antigo (sem unit_options): a unidade é perguntada logo depois da nota", async () => {
  const rows = [survey({ unit_options: null })];
  const admin = fakeAdmin(rows, UNITS);
  const say = (body: string, at = NOW) => handleNps(admin, "c1", body, at);

  assertEquals(await say("8"), NPS_TEXT.unitAfterScoreQuestion(UNITS));
  assertEquals([rows[0].status, rows[0].score, rows[0].unit_id], ["ASKING", 8, null]);
  assertEquals(rows[0].unit_options, UNITS, "a lista enviada fica gravada para o número digitado apontar para ela");

  assertEquals(await say("9", NOW + MIN), NPS_TEXT.retryUnit(UNITS), "9 está fora da lista de 3 unidades");
  assertEquals(await say("oi", NOW + MIN), null, "texto livre não é resposta");
  assertEquals(await say("3", NOW + 2 * MIN), NPS_TEXT.teamQuestion, "depois da unidade vem a equipe, não a nota de novo");
  assertEquals(rows[0].unit_id, "u3");

  assertEquals(await say("4", NOW + 3 * MIN), NPS_TEXT.spaceQuestion);
  assertEquals(await say("5", NOW + 4 * MIN), NPS_TEXT.commentQuestion(8));
  assertEquals([rows[0].status, rows[0].score_team, rows[0].score_space, rows[0].unit_id], ["SCORED", 4, 5, "u3"]);
});

Deno.test("template antigo sem unidades cadastradas segue direto para a equipe", async () => {
  const rows = [survey({ unit_options: null })];
  assertEquals(await handleNps(fakeAdmin(rows, []), "c1", "8", NOW), NPS_TEXT.teamQuestion);
  assertEquals([rows[0].status, rows[0].score, rows[0].unit_options], ["ASKING", 8, null]);
});

Deno.test("recusar a contribuição encerra sem comentário", async () => {
  const rows = [survey({ status: "SCORED", score: 6, score_team: 3, score_space: 3, last_step_ms: NOW - MIN })];
  const admin = fakeAdmin(rows);
  assertEquals(await handleNps(admin, "c1", "Não", NOW), NPS_TEXT.thanksNoComment);
  assertEquals([rows[0].status, rows[0].feedback], ["DONE", null]);
});

Deno.test("mídia sem texto na pergunta da contribuição espera o texto", async () => {
  const rows = [survey({ status: "SCORED", score: 9, score_team: 5, score_space: 5, last_step_ms: NOW - MIN })];
  assertEquals(await handleNps(fakeAdmin(rows), "c1", "   ", NOW), null);
  assertEquals(rows[0].status, "SCORED");
});

Deno.test("pesquisa antiga da régua (SCORED sem equipe/espaço) ainda aceita a contribuição", async () => {
  const rows = [survey({ status: "SCORED", score: 9, scored_at_ms: NOW - MIN, unit_options: null })];
  assertEquals(await handleNps(fakeAdmin(rows), "c1", "Adorei", NOW), NPS_TEXT.thanks);
  assertEquals(rows[0].feedback, "Adorei");
});

Deno.test("janelas: 7 dias na primeira resposta, 24h entre as etapas", async () => {
  const old = [survey({ sent_at_ms: NOW - 8 * 24 * 60 * MIN })];
  assertEquals(await handleNps(fakeAdmin(old), "c1", "2", NOW), null);
  assertEquals(old[0].status, "EXPIRED");

  const stalled = [survey({ status: "ASKING", score: 9, last_step_ms: NOW - 25 * 60 * MIN })];
  assertEquals(await handleNps(fakeAdmin(stalled), "c1", "5", NOW), null);
  assertEquals([stalled[0].status, stalled[0].score_team], ["DONE", null], "encerra com o que tem; nota 9 fica");

  const fresh = [survey({ sent_at_ms: NOW - 6 * 24 * 60 * MIN })];
  assertEquals(await handleNps(fakeAdmin(fresh), "c1", "1", NOW), NPS_TEXT.scoreQuestion("Playground Bosque"));
});

Deno.test("reenvio duplicado do mesmo webhook responde uma vez só", async () => {
  const rows = [survey()];
  const admin = fakeAdmin(rows);
  const [a, b] = await Promise.all([handleNps(admin, "c1", "2", NOW), handleNps(admin, "c1", "2", NOW)]);
  assertEquals([a, b].filter((r) => r !== null).length, 1, "só uma das duas entregas responde");
  assertEquals(rows[0].unit_id, "u2");
});

Deno.test("contato sem pesquisa aberta segue como conversa normal", async () => {
  assertEquals(await handleNps(fakeAdmin([survey({ status: "DONE" })]), "c1", "9", NOW), null);
  assertEquals(await handleNps(fakeAdmin([survey()]), "outro", "9", NOW), null);
});

Deno.test("unidade: vale a da visita, não a digitada; sessão depois do envio não conta", async () => {
  const contacts = [{ id: "c1", guardian_id: "g1" }];
  const sessions = [
    { guardian_id: "g1", status: "FINALIZADA", unit_id: "u3", checkout_at_ms: NOW - 4 * 60 * MIN },
    { guardian_id: "g1", status: "FINALIZADA", unit_id: "u1", checkout_at_ms: NOW - 3 * 60 * MIN + 1 },
    { guardian_id: "g1", status: "CANCELADA", unit_id: "u1", checkout_at_ms: NOW - 3 * 60 * MIN - 1 },
  ];
  const rows = [survey()];
  const admin = fakeAdmin(rows, [], { fa_crm_contacts: contacts, fa_kiosk_sessions: sessions });
  assertEquals(await handleNps(admin, "c1", "2", NOW), NPS_TEXT.scoreQuestion("Circuito Parque"));
  assertEquals(rows[0].unit_id, "u3", "digitou 2 (Playground Parque), mas a visita foi no Circuito");
});

Deno.test("unidade: sem responsável ou sem visita conhecida, vale a digitada", async () => {
  const semResponsavel = [survey()];
  const a = fakeAdmin(semResponsavel, [], { fa_crm_contacts: [{ id: "c1", guardian_id: null }], fa_kiosk_sessions: [] });
  assertEquals(await handleNps(a, "c1", "2", NOW), NPS_TEXT.scoreQuestion("Playground Parque"));
  assertEquals(semResponsavel[0].unit_id, "u2");

  const semVisita = [survey()];
  const b = fakeAdmin(semVisita, [], { fa_crm_contacts: [{ id: "c1", guardian_id: "g1" }], fa_kiosk_sessions: [] });
  assertEquals(await handleNps(b, "c1", "1", NOW), NPS_TEXT.scoreQuestion("Playground Bosque"));
  assertEquals(semVisita[0].unit_id, "u1");
});
