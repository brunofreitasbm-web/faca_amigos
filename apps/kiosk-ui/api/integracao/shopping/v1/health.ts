import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateShoppingRequest, createServiceClient } from "../../../_shopping/common.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createServiceClient();
  const unit = await authenticateShoppingRequest(supabase, req, res);
  if (!unit) return;

  return res.status(200).json({
    ok: true,
    escopo: "FATURAMENTO_LEITURA",
    layoutVersao: "1.0",
    nowMs: Date.now(),
  });
}
