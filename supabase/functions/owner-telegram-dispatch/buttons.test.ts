// node --experimental-strip-types --test supabase/functions/owner-telegram-dispatch/buttons.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { BUTTON_TYPES, divergenceKeyboard, secretFingerprint, webhookSecret } from "./buttons.ts";

const ID = "03b3b8b8-02f8-4a9d-b2fa-3698b7e9c7ad";

test("callback_data casa com o regex do webhook e cabe em 64 bytes", () => {
  const webhookRe = /^dv:(ok|just|pend|reopen):([0-9a-f-]{36})$/;
  const buttons = divergenceKeyboard(ID).inline_keyboard.flat();
  assert.equal(buttons.length, 3);
  for (const b of buttons) {
    assert.match(b.callback_data, webhookRe);
    assert.ok(new TextEncoder().encode(b.callback_data).length <= 64);
    assert.ok(b.callback_data.endsWith(ID));
  }
  assert.deepEqual(
    buttons.map((b) => b.callback_data.split(":")[1]),
    ["ok", "just", "pend"],
  );
});

test("só as divergências levam botões", () => {
  assert.deepEqual([...BUTTON_TYPES].sort(), ["DIVERGENCIA_ABERTURA", "DIVERGENCIA_FECHAMENTO"]);
  assert.ok(!BUTTON_TYPES.has("FECHAMENTO"));
});

test("segredo do webhook = sha256('<token>:owner-telegram-webhook') em hex (igual ao do webhook)", async () => {
  const token = "123456:ABC-def";
  const expected = createHash("sha256").update(`${token}:owner-telegram-webhook`).digest("hex");
  assert.equal(await webhookSecret(token), expected);
  // O Telegram só aceita A-Z a-z 0-9 _ - no secret_token, de 1 a 256 caracteres.
  assert.match(expected, /^[A-Za-z0-9_-]{1,256}$/);
});

test("impressão digital: curta, estável e muda com o token (rotação re-registra o webhook)", async () => {
  const a = await secretFingerprint(await webhookSecret("tokenA"));
  const b = await secretFingerprint(await webhookSecret("tokenB"));
  assert.equal(a.length, 16);
  assert.equal(a, await secretFingerprint(await webhookSecret("tokenA")));
  assert.notEqual(a, b);
  // não vaza o segredo
  assert.ok(!(await webhookSecret("tokenA")).startsWith(a));
});
