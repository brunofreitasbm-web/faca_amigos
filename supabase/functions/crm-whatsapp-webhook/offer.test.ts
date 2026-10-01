// deno test supabase/functions/crm-whatsapp-webhook/offer.test.ts
import { offerButton, offerInfoKey } from "./offer.ts";

function assertEquals(actual: unknown, expected: unknown, msg = "") {
  if (actual !== expected) throw new Error(`${msg} esperado ${expected}, veio ${actual}`);
}

Deno.test("botão de oferta pelo payload", () => {
  assertEquals(offerButton("OFERTA_INFO", "Quero saber mais"), "OFERTA_INFO");
  assertEquals(offerButton("OFERTA_NAO", "Agora não"), "OFERTA_NAO");
  assertEquals(offerButton("RENOVAR_1", "Opção 1"), null, "payload de renovação");
});

Deno.test("título do botão digitado conta como toque", () => {
  assertEquals(offerButton(undefined, "Quero saber mais!"), "OFERTA_INFO");
  assertEquals(offerButton(undefined, "agora nao"), "OFERTA_NAO");
  assertEquals(offerButton(undefined, "Agora não."), "OFERTA_NAO");
});

Deno.test("'quero' sozinho continua sendo aceite do opt-in", () => {
  assertEquals(offerButton(undefined, "Quero"), null);
  assertEquals(offerButton(undefined, "sim"), null);
});

Deno.test("winback divide o texto de resposta", () => {
  assertEquals(offerInfoKey("WINBACK_1"), "WINBACK");
  assertEquals(offerInfoKey("WINBACK_2"), "WINBACK");
  assertEquals(offerInfoKey("DEGRAU_PORTO"), "DEGRAU_PORTO");
});
