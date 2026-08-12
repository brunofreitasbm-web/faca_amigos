import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AppContext } from "../context.js";
import { uuidv7, listUnits } from "@facaamigos/db-local";


export interface SecretItem {
  id: string;
  payload: string;
  createdAtMs: number;
  expiresAtMs: number;
  viewCount: number;
  maxViews: number;
}

// Armazenamento local de segredos temporários com expiração TTL (substituível por Vercel KV/Redis em prod)
const localSecretStore = new Map<string, SecretItem>();

// Limpeza automática de segredos expirados a cada 10 minutos
setInterval(() => {
  const now = Date.now();
  for (const [id, secret] of localSecretStore.entries()) {
    if (now > secret.expiresAtMs) {
      localSecretStore.delete(id);
    }
  }
}, 600000);

export function registerSecretVaultRoutes(app: FastifyInstance, ctx: AppContext) {
  // 1. Criar um segredo temporário (One-Time Link)
  app.post("/api/secret/create", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { payload?: string; ttlHours?: number; maxViews?: number };

    if (!body.payload || typeof body.payload !== "string" || body.payload.trim() === "") {
      return reply.code(400).send({ error: "PAYLOAD_INVALIDO", message: "O conteúdo da credencial é obrigatório." });
    }

    const nowMs = ctx.nowMs();
    const id = uuidv7(nowMs);
    const ttlHours = body.ttlHours && body.ttlHours > 0 ? body.ttlHours : 24;
    const expiresAtMs = nowMs + ttlHours * 3600 * 1000;
    const maxViews = body.maxViews && body.maxViews > 0 ? body.maxViews : 1;

    const secretItem: SecretItem = {
      id,
      payload: body.payload.trim(),
      createdAtMs: nowMs,
      expiresAtMs,
      viewCount: 0,
      maxViews,
    };

    localSecretStore.set(id, secretItem);

    // Também registra no banco de dados local para persistência de audit (usando a primeira unidade existente)
    const primaryUnit = listUnits(ctx.db)[0];
    const unitId = primaryUnit ? primaryUnit.id : "00000000-0000-0000-0000-000000000000";

    ctx.db.prepare(
      `INSERT INTO app_settings (unit_id, key, value, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (unit_id, key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms`
    ).run(unitId, `secret_${id}`, JSON.stringify(secretItem), nowMs);

    return {
      ok: true,
      id,
      secretUrl: `/segredo/${id}`,
      expiresAtMs,
      maxViews,
    };
  });

  // 2. Revelar e Destruir o segredo (One-Time Read)
  app.get("/api/secret/:id", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const nowMs = ctx.nowMs();

    let secret = localSecretStore.get(id);

    if (!secret) {
      // Tenta recuperar da persistência local se não estiver na memória
      const dbRow = ctx.db.prepare("SELECT unit_id, value FROM app_settings WHERE key = ?").get(`secret_${id}`) as { unit_id: string; value: string } | undefined;
      if (dbRow) {
        try {
          secret = JSON.parse(dbRow.value) as SecretItem;
        } catch {
          // JSON malformado
        }
      }
    }

    if (!secret) {
      return reply.code(404).send({
        error: "SECRET_NOT_FOUND",
        message: "Este link seguro já foi lido e destruído ou expirou permanentemente.",
      });
    }

    if (nowMs > secret.expiresAtMs || secret.viewCount >= secret.maxViews) {
      // Remove do banco e da memória
      localSecretStore.delete(id);
      ctx.db.prepare("DELETE FROM app_settings WHERE key = ?").run(`secret_${id}`);

      return reply.code(404).send({
        error: "SECRET_EXPIRED",
        message: "Este link seguro já foi lido e destruído ou expirou permanentemente.",
      });
    }

    // Incrementa contador de visualização e DESTRÓI imediatamente se atingiu maxViews (Padrão One-Time Read)
    secret.viewCount += 1;
    if (secret.viewCount >= secret.maxViews) {
      localSecretStore.delete(id);
      ctx.db.prepare("DELETE FROM app_settings WHERE key = ?").run(`secret_${id}`);
    } else {
      localSecretStore.set(id, secret);
      ctx.db.prepare("UPDATE app_settings SET value = ? WHERE key = ?").run(JSON.stringify(secret), `secret_${id}`);
    }


    return {
      ok: true,
      payload: secret.payload,
      destroyed: secret.viewCount >= secret.maxViews,
      readAtMs: nowMs,
    };
  });
}
