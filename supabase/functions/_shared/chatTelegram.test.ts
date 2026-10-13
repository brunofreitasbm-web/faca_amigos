// node --experimental-strip-types --test supabase/functions/_shared/chatTelegram.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answeredKeyboard,
  chatWebhookSecret,
  escapeHtml,
  firstName,
  formatEmployeeMessage,
  idReply,
  parseQuickReply,
  quickReplyKeyboard,
  replyPromptHtml,
  TEXT_REPLY_LABEL,
  TELEGRAM_MAX_TEXT,
} from "./chatTelegram.ts";

const ID = "123e4567-e89b-12d3-a456-426614174000";

test("escapeHtml neutraliza tags do colaborador", () => {
  assert.equal(escapeHtml("<b>oi</b> & tchau"), "&lt;b&gt;oi&lt;/b&gt; &amp; tchau");
});

test("formatEmployeeMessage inclui nome, unidade e contexto", () => {
  const out = formatEmployeeMessage({
    employeeName: "Maria",
    unitName: "Marambaia",
    context: { screen: "CAIXA", app_version: "1.42" },
    body: "Deu erro <ao> fechar",
  });
  assert.match(out, /<b>Maria<\/b> \(Marambaia\)/);
  assert.match(out, /tela CAIXA · v1\.42/);
  assert.match(out, /Deu erro &lt;ao&gt; fechar/);
});

test("formatEmployeeMessage só com imagem avisa do anexo", () => {
  const out = formatEmployeeMessage({ employeeName: "Maria", body: "", hasAttachment: true });
  assert.match(out, /enviou uma imagem/);
});

test("formatEmployeeMessage corta no limite do Telegram", () => {
  const out = formatEmployeeMessage({ employeeName: "M", body: "x".repeat(5000) });
  assert.ok(out.length <= TELEGRAM_MAX_TEXT);
});

test("callback_data cabe nos 64 bytes e faz ida e volta", () => {
  const kb = quickReplyKeyboard(ID);
  for (const row of kb.inline_keyboard) {
    for (const b of row) {
      assert.ok(new TextEncoder().encode(b.callback_data).length <= 64);
      const parsed = parseQuickReply(b.callback_data);
      assert.equal(parsed?.messageId, ID);
    }
  }
});

test("parseQuickReply rejeita lixo", () => {
  assert.equal(parseQuickReply("cr:foo:" + ID), null);
  assert.equal(parseQuickReply("dv:ok:" + ID), null);
  assert.equal(parseQuickReply("cr:rec:nao-e-uuid"), null);
});

test("answeredKeyboard mostra quem respondeu e mantém o Responder por texto", () => {
  const kb = answeredKeyboard("res", "Bruno", "12/10 14:32", ID);
  assert.equal(kb.inline_keyboard.length, 2);
  assert.equal(kb.inline_keyboard[0]![0]!.callback_data, "noop");
  assert.match(kb.inline_keyboard[0]![0]!.text, /Bruno: Resolvido/);
  assert.equal(kb.inline_keyboard[1]![0]!.text, TEXT_REPLY_LABEL);
  assert.deepEqual(parseQuickReply(kb.inline_keyboard[1]![0]!.callback_data), { action: "txt", messageId: ID });
});

test("answeredKeyboard sem id não oferece o Responder por texto", () => {
  assert.equal(answeredKeyboard("rec", "Isa", "x").inline_keyboard.length, 1);
});

test("o teclado inicial tem Responder por texto e parseQuickReply entende txt", () => {
  const all = quickReplyKeyboard(ID).inline_keyboard.flat();
  const txt = all.find((b) => b.text === TEXT_REPLY_LABEL);
  assert.ok(txt);
  assert.equal(parseQuickReply(txt!.callback_data)?.action, "txt");
});

test("replyPromptHtml menciona o admin por id e escapa nomes", () => {
  const html = replyPromptHtml({ adminName: "Bruno <x>", adminTgId: 6728797176, employeeName: "Maria & Cia", unitName: "Playground" });
  assert.match(html, /tg:\/\/user\?id=6728797176/);
  assert.match(html, /Bruno &lt;x&gt;/);
  assert.match(html, /<b>Maria &amp; Cia<\/b> \(Playground\)/);
});

test("idReply mostra o id de quem perguntou e, se informado, o do chat", () => {
  assert.match(idReply(123), /<code>123<\/code>/);
  assert.doesNotMatch(idReply(123), /chat/);
  assert.match(idReply(123, -1001234), /Id deste chat: <code>-1001234<\/code>/);
});

test("firstName pega o primeiro nome e tem fallback", () => {
  assert.equal(firstName("Isabella goncalves"), "Isabella");
  assert.equal(firstName("  "), "Owner");
  assert.equal(firstName(null, "Admin"), "Admin");
});

test("chatWebhookSecret é estável e diferente do segredo do bot do caixa", async () => {
  const a = await chatWebhookSecret("tok");
  assert.equal(a, await chatWebhookSecret("tok"));
  assert.notEqual(a, await chatWebhookSecret("tok2"));
  assert.match(a, /^[0-9a-f]{64}$/);
});
