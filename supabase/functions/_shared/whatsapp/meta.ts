// Implementação do provedor Meta Cloud API para WhatsApp
import type {
  InboundMessage,
  SendMediaParams,
  SendResult,
  SendTemplateParams,
  SendTextParams,
  StatusUpdate,
  TemplateComponent,
  WhatsAppProvider,
} from "./types.ts";
import { timingSafeEqual } from "./twilio.ts";

export interface MetaConfig {
  phoneNumberId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  apiVersion?: string;
}

const DEFAULT_API_VERSION = "v21.0";

const META_STATUS_MAP: Record<string, StatusUpdate["status"]> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

function getEnv(key: string): string | undefined {
  if (typeof Deno !== "undefined" && Deno.env?.get) return Deno.env.get(key);
  if (typeof process !== "undefined" && process.env) return process.env[key];
  return undefined;
}

export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta" as const;
  private phoneNumberId: string;
  private accessToken: string;
  private appSecret: string;
  private verifyToken: string;
  private apiVersion: string;

  constructor(config?: MetaConfig) {
    this.phoneNumberId =
      config?.phoneNumberId ?? getEnv("META_PHONE_NUMBER_ID") ?? "";
    this.accessToken =
      config?.accessToken ?? getEnv("META_ACCESS_TOKEN") ?? "";
    this.appSecret =
      config?.appSecret ?? getEnv("META_APP_SECRET") ?? "";
    this.verifyToken =
      config?.verifyToken ?? getEnv("META_VERIFY_TOKEN") ?? "";
    this.apiVersion =
      config?.apiVersion ?? getEnv("META_API_VERSION") ?? DEFAULT_API_VERSION;
  }

  private getMessagesEndpoint(): string {
    return `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  private cleanPhone(phone: string): string {
    return phone.replace(/^whatsapp:/i, "").replace(/\+/g, "").trim();
  }

  async sendText(params: SendTextParams): Promise<SendResult> {
    if (!this.phoneNumberId || !this.accessToken) {
      return { ok: false, error: "Meta credentials not configured" };
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.cleanPhone(params.to),
      type: "text",
      text: {
        preview_url: true,
        body: params.body,
      },
    };

    return this.postJson(payload);
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    if (!this.phoneNumberId || !this.accessToken) {
      return { ok: false, error: "Meta credentials not configured" };
    }
    if (!params.templateName) {
      return { ok: false, error: "Meta requires templateName for template messages" };
    }

    let components = params.components;
    if (!components && params.variables && Object.keys(params.variables).length > 0) {
      // Converte variáveis indexadas {"1": "val1", "2": "val2"} para parâmetros de body da Meta
      const sortedKeys = Object.keys(params.variables).sort((a, b) => Number(a) - Number(b));
      components = [
        {
          type: "body",
          parameters: sortedKeys.map((k) => ({
            type: "text",
            text: params.variables![k] ?? "",
          })),
        },
      ];
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.cleanPhone(params.to),
      type: "template",
      template: {
        name: params.templateName,
        language: {
          code: params.languageCode || "pt_BR",
        },
        ...(components && components.length > 0 ? { components } : {}),
      },
    };

    return this.postJson(payload);
  }

  async sendMedia(params: SendMediaParams): Promise<SendResult> {
    if (!this.phoneNumberId || !this.accessToken) {
      return { ok: false, error: "Meta credentials not configured" };
    }

    const mediaType = params.mediaType || "image";
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.cleanPhone(params.to),
      type: mediaType,
      [mediaType]: {
        link: params.mediaUrl,
        ...(params.caption ? { caption: params.caption } : {}),
      },
    };

    return this.postJson(payload);
  }

  private async postJson(payload: unknown): Promise<SendResult> {
    try {
      const res = await fetch(this.getMessagesEndpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = out?.error;
        console.error("Meta recusou envio:", err?.code, err?.message);
        return {
          ok: false,
          error: err?.message ?? "Meta recusou o envio",
          errorCode: err?.code,
        };
      }

      const wamid = out?.messages?.[0]?.id;
      return {
        ok: true,
        messageId: wamid,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  verifyWebhookChallenge(url: URL): Response | null {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token && this.verifyToken && token === this.verifyToken) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return null;
  }

  async parseInbound(req: Request, rawBody?: string): Promise<InboundMessage | null> {
    const text = rawBody ?? (await req.clone().text().catch(() => ""));
    if (!text) return null;

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      return null;
    }

    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    if (!value) return null;

    // Detecta mensagens regulares ou ecos de coexistência
    const isEcho = Boolean(value.smb_message_echoes && value.smb_message_echoes.length > 0);
    const messages = isEcho ? value.smb_message_echoes : value.messages;
    if (!messages || messages.length === 0) return null;

    const msg = messages[0];
    const contact = value.contacts?.[0];
    const metadata = value.metadata;

    const from = msg.from ? `+${msg.from.replace(/\+/g, "")}` : "";
    const to = metadata?.display_phone_number
      ? `+${metadata.display_phone_number.replace(/\D/g, "")}`
      : "";

    let body = "";
    let buttonPayload: string | undefined;
    const media: InboundMessage["media"] = [];

    if (msg.type === "text") {
      body = msg.text?.body ?? "";
    } else if (msg.type === "button") {
      body = msg.button?.text ?? "";
      buttonPayload = msg.button?.payload;
    } else if (msg.type === "interactive") {
      const interactive = msg.interactive;
      if (interactive.type === "button_reply") {
        body = interactive.button_reply?.title ?? "";
        buttonPayload = interactive.button_reply?.id;
      } else if (interactive.type === "list_reply") {
        body = interactive.list_reply?.title ?? "";
        buttonPayload = interactive.list_reply?.id;
      }
    } else if (["image", "video", "audio", "document"].includes(msg.type)) {
      const m = msg[msg.type];
      body = m?.caption ?? "";
      if (m?.id) {
        media.push({
          id: m.id,
          contentType: m.mime_type,
        });
      }
    }

    return {
      messageId: msg.id,
      from,
      to,
      body: body.trim(),
      profileName: contact?.profile?.name || null,
      media,
      buttonPayload,
      timestamp: Number(msg.timestamp) ? Number(msg.timestamp) * 1000 : Date.now(),
      isEcho,
    };
  }

  async parseStatus(req: Request, rawBody?: string): Promise<StatusUpdate | null> {
    const text = rawBody ?? (await req.clone().text().catch(() => ""));
    if (!text) return null;

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      return null;
    }

    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const statuses = value?.statuses;
    if (!statuses || statuses.length === 0) return null;

    const st = statuses[0];
    const mapped = META_STATUS_MAP[st.status] ?? "queued";
    const error = st.errors?.[0];

    // Mapeamento de erro da Meta para código conhecido:
    // 131047: fora da janela de 24h (equivalente a 63016)
    // 131026 / 131030: número não tem WhatsApp (equivalente a 63024)
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    if (error) {
      errorCode = String(error.code);
      errorMessage = error.message || error.title || `Meta ${error.code}`;
      if (errorCode === "131047") {
        errorMessage = `Fora da janela de 24h (Meta 131047)`;
      } else if (errorCode === "131030" || errorCode === "131026") {
        errorMessage = `Destinatário inválido (Meta ${errorCode})`;
      }
    }

    return {
      messageId: st.id,
      status: mapped,
      errorCode,
      errorMessage,
      timestamp: Number(st.timestamp) ? Number(st.timestamp) * 1000 : Date.now(),
      raw: st,
    };
  }

  async verifySignature(req: Request, rawBody?: string): Promise<boolean> {
    if (!this.appSecret) return false;
    const header = req.headers.get("X-Hub-Signature-256") ?? "";
    if (!header.startsWith("sha256=")) return false;
    const expectedHash = header.slice(7);

    const body = rawBody ?? (await req.clone().text().catch(() => ""));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.appSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const hashArray = Array.from(new Uint8Array(signature));
    const calculatedHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    return timingSafeEqual(calculatedHash, expectedHash);
  }
}
