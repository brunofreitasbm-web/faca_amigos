// Testes unitários da camada lib/whatsapp
import { getWhatsAppProvider } from "./provider.ts";
import { TwilioWhatsAppProvider, timingSafeEqual } from "./twilio.ts";
import { MetaWhatsAppProvider } from "./meta.ts";

function assertEquals(actual: unknown, expected: unknown, msg = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg} esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`);
  }
}

// 1. Provedor padrão é Twilio
const defaultProvider = getWhatsAppProvider();
assertEquals(defaultProvider.name, "twilio", "Provedor padrão deve ser twilio");

// 2. Provedor Meta quando especificado
const metaProvider = getWhatsAppProvider("meta");
assertEquals(metaProvider.name, "meta", "Provedor deve ser meta");

// 3. Timing-safe comparison
assertEquals(timingSafeEqual("abc", "abc"), true, "Strings iguais devem bater");
assertEquals(timingSafeEqual("abc", "abd"), false, "Strings diferentes devem falhar");
assertEquals(timingSafeEqual("abc", "abcd"), false, "Tamanhos diferentes devem falhar");

// 4. Parse inbound e status no Twilio
const twilio = new TwilioWhatsAppProvider({
  accountSid: "AC123",
  authToken: "tok123",
  webhookPublicUrl: "https://example.com/webhook",
});

// Twilio Inbound
const twilioInboundBody = "MessageSid=SM123&From=whatsapp%3A%2B559199999999&To=whatsapp%3A%2B559188888888&Body=Ol%C3%A1&ProfileName=Maria";
const parsedInbound = await twilio.parseInbound(new Request("https://example.com"), twilioInboundBody);
assertEquals(parsedInbound?.messageId, "SM123");
assertEquals(parsedInbound?.from, "+559199999999");
assertEquals(parsedInbound?.to, "+559188888888");
assertEquals(parsedInbound?.body, "Olá");
assertEquals(parsedInbound?.profileName, "Maria");
assertEquals(parsedInbound?.isEcho, false);

// Twilio Status
const twilioStatusBody = "MessageSid=SM123&MessageStatus=delivered";
const parsedStatus = await twilio.parseStatus(new Request("https://example.com"), twilioStatusBody);
assertEquals(parsedStatus?.messageId, "SM123");
assertEquals(parsedStatus?.status, "delivered");

// 5. Parse inbound e status na Meta
const meta = new MetaWhatsAppProvider({
  phoneNumberId: "phone123",
  accessToken: "token123",
  appSecret: "secret123",
  verifyToken: "verify123",
});

// Meta Inbound
const metaInboundJson = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { display_phone_number: "559188888888" },
            contacts: [{ profile: { name: "Maria" } }],
            messages: [
              {
                id: "wamid.123",
                from: "559199999999",
                type: "text",
                text: { body: "Olá Meta" },
                timestamp: "1700000000",
              },
            ],
          },
        },
      ],
    },
  ],
});
const parsedMetaInbound = await meta.parseInbound(new Request("https://example.com"), metaInboundJson);
assertEquals(parsedMetaInbound?.messageId, "wamid.123");
assertEquals(parsedMetaInbound?.from, "+559199999999");
assertEquals(parsedMetaInbound?.to, "+559188888888");
assertEquals(parsedMetaInbound?.body, "Olá Meta");
assertEquals(parsedMetaInbound?.profileName, "Maria");
assertEquals(parsedMetaInbound?.isEcho, false);

// Meta Coexistence Echo
const metaEchoJson = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { display_phone_number: "559188888888" },
            smb_message_echoes: [
              {
                id: "wamid.echo456",
                from: "559199999999",
                type: "text",
                text: { body: "Mensagem enviada do app Business celular" },
                timestamp: "1700000000",
              },
            ],
          },
        },
      ],
    },
  ],
});
const parsedMetaEcho = await meta.parseInbound(new Request("https://example.com"), metaEchoJson);
assertEquals(parsedMetaEcho?.messageId, "wamid.echo456");
assertEquals(parsedMetaEcho?.isEcho, true);

// Meta Status com erro 131047 (fora da janela de 24h)
const metaStatusJson = JSON.stringify({
  entry: [
    {
      changes: [
        {
          value: {
            statuses: [
              {
                id: "wamid.123",
                status: "failed",
                errors: [{ code: 131047, title: "Re-engagement message" }],
                timestamp: "1700000000",
              },
            ],
          },
        },
      ],
    },
  ],
});
const parsedMetaStatus = await meta.parseStatus(new Request("https://example.com"), metaStatusJson);
assertEquals(parsedMetaStatus?.messageId, "wamid.123");
assertEquals(parsedMetaStatus?.status, "failed");
assertEquals(parsedMetaStatus?.errorCode, "131047");

// Meta Webhook Challenge
const challengeUrl = new URL("https://example.com/webhook?hub.mode=subscribe&hub.verify_token=verify123&hub.challenge=test_challenge_code");
const challengeRes = meta.verifyWebhookChallenge(challengeUrl);
assertEquals(challengeRes?.status, 200);

console.log("Todos os testes unitários da camada lib/whatsapp passaram com sucesso!");
