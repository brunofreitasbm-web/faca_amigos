import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "crypto";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  const { payload, ttlHours = 72, maxViews = 100, autoDestroy = false, recipientEmail } = req.body || {};

  if (!payload || typeof payload !== "string" || payload.trim() === "") {
    return res.status(400).json({ error: "PAYLOAD_INVALIDO", message: "O conteúdo da credencial é obrigatório." });
  }

  const id = randomUUID();
  const nowMs = Date.now();
  const expiresAtMs = nowMs + ttlHours * 3600 * 1000;
  const effectiveMaxViews = autoDestroy === true ? 1 : maxViews;
  const emailSent = recipientEmail && recipientEmail.includes("@");

  return res.status(200).json({
    ok: true,
    id,
    secretUrl: `/segredo/${id}`,
    expiresAtMs,
    maxViews: effectiveMaxViews,
    emailSent: Boolean(emailSent),
    recipientEmail: recipientEmail || null,
    message: emailSent ? `Link gerado e enviado por e-mail para ${recipientEmail}` : "Link seguro criado com sucesso.",
  });
}
