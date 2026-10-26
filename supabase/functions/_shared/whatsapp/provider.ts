// Seleção e factory de provedores WhatsApp
import type { WhatsAppProvider, WhatsAppProviderName } from "./types.ts";
import { TwilioWhatsAppProvider } from "./twilio.ts";
import { MetaWhatsAppProvider } from "./meta.ts";

export function getProviderName(): WhatsAppProviderName {
  const envVal = (
    typeof Deno !== "undefined"
      ? Deno.env.get("WHATSAPP_PROVIDER")
      : typeof process !== "undefined"
        ? process.env.WHATSAPP_PROVIDER
        : undefined
  )?.toLowerCase().trim();

  return envVal === "meta" ? "meta" : "twilio";
}

let cachedProvider: WhatsAppProvider | null = null;
let cachedProviderName: WhatsAppProviderName | null = null;

export function getWhatsAppProvider(forceProvider?: WhatsAppProviderName): WhatsAppProvider {
  const chosen = forceProvider ?? getProviderName();

  if (cachedProvider && cachedProviderName === chosen && !forceProvider) {
    return cachedProvider;
  }

  let provider: WhatsAppProvider;
  if (chosen === "meta") {
    provider = new MetaWhatsAppProvider();
  } else {
    provider = new TwilioWhatsAppProvider();
  }

  if (!forceProvider) {
    cachedProvider = provider;
    cachedProviderName = chosen;
  }

  return provider;
}
