// Tipos da camada de abstração de WhatsApp (Twilio e Meta Cloud API)

export type WhatsAppProviderName = "twilio" | "meta";

export interface SendTextParams {
  from: string;
  to: string;
  body: string;
  statusCallbackUrl?: string;
}

export interface TemplateComponentParameter {
  type: "text" | "payload" | "image" | "document" | "video";
  text?: string;
  payload?: string;
  image?: { link: string };
  document?: { link: string; filename?: string };
}

export interface TemplateComponent {
  type: "header" | "body" | "button";
  sub_type?: "url" | "quick_reply";
  index?: number | string;
  parameters: TemplateComponentParameter[];
}

export interface SendTemplateParams {
  from: string;
  to: string;
  templateName?: string;
  contentSid?: string;
  languageCode?: string;
  variables?: Record<string, string>;
  components?: TemplateComponent[];
  statusCallbackUrl?: string;
}

export interface SendMediaParams {
  from: string;
  to: string;
  mediaUrl: string;
  caption?: string;
  contentType?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  statusCallbackUrl?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string | number;
}

export interface InboundMedia {
  url?: string;
  id?: string;
  contentType?: string;
}

export interface InboundMessage {
  messageId: string;
  from: string;
  to: string;
  body: string;
  profileName?: string | null;
  media: InboundMedia[];
  buttonPayload?: string;
  timestamp?: number;
  isEcho?: boolean;
}

export interface StatusUpdate {
  messageId: string;
  status: "queued" | "sent" | "delivered" | "read" | "failed" | "undelivered";
  errorCode?: string | null;
  errorMessage?: string | null;
  timestamp?: number;
  raw?: unknown;
}

export interface WhatsAppProvider {
  readonly name: WhatsAppProviderName;
  sendText(params: SendTextParams): Promise<SendResult>;
  sendTemplate(params: SendTemplateParams): Promise<SendResult>;
  sendMedia(params: SendMediaParams): Promise<SendResult>;
  parseInbound(req: Request, rawBody?: string): Promise<InboundMessage | null>;
  parseStatus(req: Request, rawBody?: string): Promise<StatusUpdate | null>;
  verifySignature(req: Request, rawBody?: string): Promise<boolean>;
}
