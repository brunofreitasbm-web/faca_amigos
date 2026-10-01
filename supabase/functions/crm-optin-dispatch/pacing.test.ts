// deno test supabase/functions/crm-optin-dispatch/pacing.test.ts
import {
  dailyTarget,
  gapMs,
  MAX_PER_RUN,
  nextRampLevel,
  RUN_EVERY_MIN,
  runQuota,
  WINDOW_END_MIN,
  WINDOW_START_MIN,
} from "./pacing.ts";

function assertEquals(actual: unknown, expected: unknown, msg = "") {
  if (actual !== expected) throw new Error(`${msg} esperado ${expected}, veio ${actual}`);
}

Deno.test("rampa: 30, 45, 67, 101, 151 limitada ao teto", () => {
  const levels = [0, 1, 2, 3, 4].map((l) => dailyTarget(l, 150, 10_000, 1_000));
  assertEquals(levels.join(","), "30,45,67,101,150");
});

Deno.test("prazo apertado puxa a meta acima da rampa, sem passar do teto", () => {
  assertEquals(dailyTarget(0, 150, 600, 5), 120);
  assertEquals(dailyTarget(0, 150, 2_000, 5), 150);
  assertEquals(dailyTarget(0, 150, 600, 0), 150, "prazo vencido conta como 1 dia");
});

Deno.test("meta nunca passa do que resta na fila", () => {
  assertEquals(dailyTarget(3, 150, 12, 10), 12);
  assertEquals(dailyTarget(0, 150, 0, 10), 0);
});

Deno.test("rampa só sobe com envios e PARAR baixo", () => {
  assertEquals(nextRampLevel(2, 0, 0), 2, "pausada: mantém");
  assertEquals(nextRampLevel(2, 100, 1), 3, "1% de PARAR: sobe");
  assertEquals(nextRampLevel(2, 100, 2), 2, "2% de PARAR: segura");
  assertEquals(nextRampLevel(2, 5, 1), 3, "amostra pequena não segura");
});

Deno.test("quota: nada fora da janela ou com a meta cumprida", () => {
  assertEquals(runQuota(100, 0, WINDOW_START_MIN - 1), 0);
  assertEquals(runQuota(100, 0, WINDOW_END_MIN), 0);
  assertEquals(runQuota(100, 100, 12 * 60), 0);
});

Deno.test("dia simulado fecha perto da meta, de 0 a 2 por rodada", () => {
  for (const target of [30, 67, 150]) {
    let seed = target;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let sent = 0;
    const perRun: number[] = [];
    for (let m = WINDOW_START_MIN; m < WINDOW_END_MIN; m += RUN_EVERY_MIN) {
      const q = runQuota(target, sent, m, rand);
      if (q < 0 || q > MAX_PER_RUN) throw new Error(`quota ${q} fora de 0..${MAX_PER_RUN}`);
      perRun.push(q);
      sent += q;
    }
    if (sent > target || sent < target * 0.9) throw new Error(`meta ${target}: enviou ${sent}`);
    if (!perRun.includes(0))
      throw new Error(`meta ${target}: nenhuma rodada vazia, ritmo regular demais`);
  }
});

Deno.test("pausa entre envios fica entre 8 e 90 s", () => {
  assertEquals(
    gapMs(() => 0),
    8_000,
  );
  assertEquals(
    gapMs(() => 1),
    90_000,
  );
});
