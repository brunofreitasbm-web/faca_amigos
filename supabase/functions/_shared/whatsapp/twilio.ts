// Implementação do provedor Twilio para WhatsApp
import type {
  InboundMessage,
  SendMediaParams,
  SendResult,
  SendTemplateParams,
  SendTextParams,
  StatusUpdate,
  WhatsAppProvider,
} from "./types.ts";

export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  webhookPublicUrl?: string;
}

const DEFAULT_WEBHOOK_URL =
  "https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/crm-whatsapp-webhook";

const STATUS_MAP: Record<string, StatusUpdate["status"]> = {
  queued: "queued",
  accepted: "queued",
  sending: "queued",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  undelivered: "undelivered",
};

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function stripWhatsapp(v: string): string {
  return v.replace(/^whatsapp:/i, "").trim();
}

export function formatWhatsapp(phone: string): string {
  const clean = stripWhatsapp(phone);
  return `whatsapp:${clean}`;
}

function getEnv(key: string): string | undefined {
  if (typeof Deno !== "undefined" && Deno.env?.get) return Deno.env.get(key);
  if (typeof process !== "undefined" && process.env) return process.env[key];
  return undefined;
}

export class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly name = "twilio" as const;
  private accountSid: string;
  private authToken: string;
  private defaultWebhookUrl: string;

  constructor(config?: TwilioConfig) {
    this.accountSid =
      config?.accountSid ?? getEnv("TWILIO_CRM_ACCOUNT_SID") ?? "";
    this.authToken =
      config?.authToken ?? getEnv("TWILIO_CRM_AUTH_TOKEN") ?? "";
    this.defaultWebhookUrl =
      config?.webhookPublicUrl ??
      getEnv("CRM_WEBHOOK_PUBLIC_URL") ??
      DEFAULT_WEBHOOK_URL;
  }

  private getAuthHeader(): string {
    return "Basic " + btoa(`${this.accountSid}:${this.authToken}`);
  }

  private getMessagesEndpoint(): string {
    return `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
  }

  async sendText(params: SendTextParams): Promise<SendResult> {
    if (!this.accountSid || !this.authToken) {
      return { ok: false, error: "Twilio credentials not configured" };
    }
    const form = new URLSearchParams({
      From: formatWhatsapp(params.from),
      To: formatWhatsapp(params.to),
      Body: params.body,
      StatusCallback: params.statusCallbackUrl ?? this.defaultWebhookUrl,
    });

    return this.postForm(form);
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    if (!this.accountSid || !this.authToken) {
      return { ok: false, error: "Twilio credentials not configured" };
    }
    if (!params.contentSid) {
      return { ok: false, error: "Twilio requires contentSid for template messages" };
    }
    const form = new URLSearchParams({
      From: formatWhatsapp(params.from),
      To: formatWhatsapp(params.to),
      ContentSid: params.contentSid,
      StatusCallback: params.statusCallbackUrl ?? this.defaultWebhookUrl,
    });

    if (params.variables && Object.keys(params.variables).length > 0) {
      form.set("ContentVariables", JSON.stringify(params.variables));
    }

    return this.postForm(form);
  }

  async sendMedia(params: SendMediaParams): Promise<SendResult> {
    if (!this.accountSid || !this.authToken) {
      return { ok: false, error: "Twilio credentials not configured" };
    }
    const form = new URLSearchParams({
      From: formatWhatsapp(params.from),
      To: formatWhatsapp(params.to),
      MediaUrl: params.mediaUrl,
      StatusCallback: params.statusCallbackUrl ?? this.defaultWebhookUrl,
    });
    if (params.caption) {
      form.set("Body", params.caption);
    }

    return this.postForm(form);
  }

  private async postForm(form: URLSearchParams): Promise<SendResult> {
    try {
      const res = await fetch(this.getMessagesEndpoint(), {
        method: "POST",
        headers: {
          Authorization: this.getAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      });

      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Twilio recusou envio:", out?.code, out?.message);
        return {
          ok: false,
          error: out?.message ?? "Twilio recusou o envio",
          errorCode: out?.code,
        };
      }

      return {
        ok: true,
        messageId: out.sid,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  private parseParams(rawBody?: string): Record<string, string> {
    if (!rawBody) return {};
    const sp = new URLSearchParams(rawBody);
    const params: Record<string, string> = {};
    for (const [k, v] of sp.entries()) {
      params[k] = v;
    }
    return params;
  }

  async parseInbound(req: Request, rawBody?: string): Promise<InboundMessage | null> {
    const text = rawBody ?? (await req.clone().text().catch(() => ""));
    const params = this.parseParams(text);
    const sid = params.MessageSid || params.SmsSid;
    if (!sid) return null;

    // Se é status update, não é inbound
    if (params.MessageStatus && params.SmsStatus !== "received") {
      return null;
    }

    const from = stripWhatsapp(params.From ?? "");
    const to = stripWhatsapp(params.To ?? "");
    if (!from || !to) return null;

    const numMedia = Number(params.NumMedia ?? "0") || 0;
    const media = Array.from({ length: numMedia }, (_, i) => ({
      url: params[`MediaUrl${i}`],
      contentType: params[`MediaContentType${i}`],
    })).filter((m) => Boolean(m.url));

    return {
      messageId: sid,
      from,
      to,
      body: (params.Body ?? "").trim(),
      profileName: params.ProfileName || null,
      media,
      buttonPayload: params.ButtonPayload,
      timestamp: Date.now(),
      isEcho: false,
    };
  }

  async parseStatus(req: Request, rawBody?: string): Promise<StatusUpdate | null> {
    const text = rawBody ?? (await req.clone().text().catch(() => ""));
    const params = this.parseParams(text);
    const sid = params.MessageSid || params.SmsSid;
    if (!sid) return null;

    if (!params.MessageStatus || params.SmsStatus === "received") {
      return null;
    }

    const rawStatus = (params.MessageStatus ?? "").toLowerCase();
    const mapped = STATUS_MAP[rawStatus] ?? "queued";

    return {
      messageId: sid,
      status: mapped,
      errorCode: params.ErrorCode || null,
      errorMessage: params.ErrorMessage || (params.ErrorCode ? `Twilio ${params.ErrorCode}` : null),
      timestamp: Date.now(),
      raw: params,
    };
  }

  async verifySignature(req: Request, rawBody?: string): Promise<boolean> {
    if (!this.authToken) return false;
    const signature = req.headers.get("X-Twilio-Signature") ?? "";
    if (!signature) return false;

    const text = rawBody ?? (await req.clone().text().catch(() => ""));
    const params = this.parseParams(text);
    const publicUrl = this.defaultWebhookUrl;

    const data =
      publicUrl +
      Object.keys(params)
        .sort()
        .map((k) => k + params[k])
        .join("");

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.authToken),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)),
    );
    let bin = "";
    for (const b of mac) bin += String.fromCharCode(b);
    return timingSafeEqual(btoa(bin), signature);
  }
}
