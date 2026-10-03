// deno test supabase/functions/crm-whatsapp-webhook/offer.test.ts
import { offerButton, offerInfoKey, pickProductOffer, siteOfferKeyword, welcomeWithOffer } from "./offer.ts";

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

Deno.test("escolhe a primeira oferta de produto do responsável", () => {
  const list = [
    { kind: "EXPIRACAO", guardian_id: "g1", unit_id: null },
    { kind: "WINBACK_1", guardian_id: "g1", unit_id: null },
    { kind: "DEGRAU_PORTO", guardian_id: "g2", unit_id: null },
    { kind: "VIP", guardian_id: "g1", unit_id: "u1" },
    { kind: "DEGRAU_DAYUSE", guardian_id: "g1", unit_id: null },
  ];
  assertEquals(pickProductOffer(list, "g1")?.kind, "VIP", "pula utility e winback, respeita a ordem");
  assertEquals(pickProductOffer(list, "g3"), null, "outro responsável");
  assertEquals(pickProductOffer(null, "g1"), null, "sem candidatos");
});

Deno.test("resposta ao aceite anexa a oferta", () => {
  assertEquals(welcomeWithOffer("Combinado! 💛", "Texto."), "Combinado! 💛\n\nUma sugestão para a próxima visita: Texto.");
});

Deno.test("texto pré-preenchido do card do site", () => {
  assertEquals(siteOfferKeyword("Quero saber do plano de 2 horas"), "DEGRAU_2H");
  assertEquals(siteOfferKeyword("quero 2h"), "DEGRAU_2H");
  assertEquals(siteOfferKeyword("Quero saber do Porto Seguro"), "DEGRAU_PORTO");
  assertEquals(siteOfferKeyword("QUERO o day use!"), "DEGRAU_DAYUSE");
  assertEquals(siteOfferKeyword("quero dayuse"), "DEGRAU_DAYUSE");
});

Deno.test("conversa comum não vira oferta", () => {
  assertEquals(siteOfferKeyword("Quero"), null);
  assertEquals(siteOfferKeyword("sim"), null);
  assertEquals(siteOfferKeyword("O porto seguro é bom?"), null, "sem 'quero'");
  assertEquals(siteOfferKeyword("Quero 2 bolas de sorvete"), null, "'2' sem horas");
  assertEquals(siteOfferKeyword("quero saber do day use " + "x".repeat(60)), null, "mensagem longa");
});
