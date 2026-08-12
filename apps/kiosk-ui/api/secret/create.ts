import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "crypto";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  const { payload, ttlHours = 24, maxViews = 1 } = req.body || {};

  if (!payload || typeof payload !== "string" || payload.trim() === "") {
    return res.status(400).json({ error: "PAYLOAD_INVALIDO", message: "O conteúdo da credencial é obrigatório." });
  }

  const id = randomUUID();
  const nowMs = Date.now();
  const expiresAtMs = nowMs + ttlHours * 3600 * 1000;

  return res.status(200).json({
    ok: true,
    id,
    secretUrl: `/segredo/${id}`,
    expiresAtMs,
    maxViews,
  });
}
