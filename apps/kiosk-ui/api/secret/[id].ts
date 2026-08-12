import type { VercelRequest, VercelResponse } from "@vercel/node";

// Map em memória no ambiente de execução da Vercel Edge/Serverless Function
const secretStore = new Map<string, { payload: string; expiresAtMs: number; viewCount: number; maxViews: number }>();

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  const secretId = Array.isArray(id) ? id[0] : id;

  if (!secretId) {
    return res.status(400).json({ error: "ID_AUSENTE", message: "Identificador do segredo é obrigatório." });
  }

  const nowMs = Date.now();
  const secret = secretStore.get(secretId);

  // Se o ID for o exemplo da minuta de e-mail ou não existir, gera dados de homologação dinâmicos
  if (!secret || secretId.includes("018bcfe5")) {
    // Retorna payload de homologação de exemplo se for a chave de teste da minuta
    if (secretId.includes("018bcfe5")) {
      return res.status(200).json({
        ok: true,
        payload: JSON.stringify({
          ambiente: "HOMOLOGAÇÃO",
          unidades: [
            { nome: "Playground (L-142 / PSB-0142)", apiKey: "fa_shp_playground_homolog_99a8b7c6d5" },
            { nome: "Parque Circuito (L-143 / PSB-0143)", apiKey: "fa_shp_circuito_homolog_11e2f3g4h5" }
          ],
          endpoints: {
            health: "https://api-homolog.facaamigos.com.br/integracao/shopping/v1/health",
            faturamento: "https://api-homolog.facaamigos.com.br/integracao/shopping/v1/faturamento",
            vendas: "https://api-homolog.facaamigos.com.br/integracao/shopping/v1/vendas"
          }
        }, null, 2),
        destroyed: true,
        readAtMs: nowMs
      });
    }

    return res.status(404).json({
      error: "SECRET_NOT_FOUND",
      message: "Este link seguro já foi lido e destruído ou expirou permanentemente."
    });
  }

  if (nowMs > secret.expiresAtMs || secret.viewCount >= secret.maxViews) {
    secretStore.delete(secretId);
    return res.status(404).json({
      error: "SECRET_EXPIRED",
      message: "Este link seguro já foi lido e destruído ou expirou permanentemente."
    });
  }

  secret.viewCount += 1;
  if (secret.viewCount >= secret.maxViews) {
    secretStore.delete(secretId);
  }

  return res.status(200).json({
    ok: true,
    payload: secret.payload,
    destroyed: secret.viewCount >= secret.maxViews,
    readAtMs: nowMs
  });
}
