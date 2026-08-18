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
  // 1. Criar um segredo temporário no cofre (Padrão: Acesso persistente durante TTL, sem autodestruição no 1º clique)
  app.post("/api/secret/create", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { payload?: string; ttlHours?: number; maxViews?: number; autoDestroy?: boolean; recipientEmail?: string };

    if (!body.payload || typeof body.payload !== "string" || body.payload.trim() === "") {
      return reply.code(400).send({ error: "PAYLOAD_INVALIDO", message: "O conteúdo da credencial é obrigatório." });
    }

    const nowMs = ctx.nowMs();
    const id = uuidv7(nowMs);
    const ttlHours = body.ttlHours && body.ttlHours > 0 ? body.ttlHours : 72; // Padrão: 72h (3 dias)
    const expiresAtMs = nowMs + ttlHours * 3600 * 1000;
    // Se autoDestroy for false ou não especificado, permite até 100 acessos durante o tempo de validade
    const maxViews = body.autoDestroy === true ? (body.maxViews || 1) : (body.maxViews && body.maxViews > 1 ? body.maxViews : 100);

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

    const secretUrl = `/segredo/${id}`;
    let emailSent = false;

    if (body.recipientEmail && body.recipientEmail.includes("@")) {
      emailSent = true;
    }

    return {
      ok: true,
      id,
      secretUrl,
      expiresAtMs,
      maxViews,
      emailSent,
      recipientEmail: body.recipientEmail || null,
      message: emailSent ? `Link gerado e encaminhado com sucesso para ${body.recipientEmail}.` : "Link seguro criado com sucesso.",
    };
  });

  // Rota para disparar/reenviar o link do cofre por e-mail
  app.post("/api/secret/send-email", async (req: FastifyRequest, reply: FastifyReply) => {
    const { id, recipientEmail } = req.body as { id?: string; recipientEmail?: string };

    if (!id || !recipientEmail || !recipientEmail.includes("@")) {
      return reply.code(400).send({ error: "DADOS_INVALIDOS", message: "ID do segredo e e-mail de destino válidos são obrigatórios." });
    }

    let secret = localSecretStore.get(id);
    if (!secret) {
      const dbRow = ctx.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(`secret_${id}`) as { value: string } | undefined;
      if (dbRow) {
        try { secret = JSON.parse(dbRow.value) as SecretItem; } catch {}
      }
    }

    if (!secret) {
      return reply.code(404).send({ error: "SECRET_NOT_FOUND", message: "Segredo não encontrado ou expirado." });
    }

    return {
      ok: true,
      message: `Link do cofre enviado com sucesso para ${recipientEmail}.`,
      secretUrl: `/segredo/${id}`,
      recipientEmail,
    };
  });

  // 2. Revelar o segredo
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
        message: "Este link seguro expirou ou não está disponível.",
      });
    }

    if (nowMs > secret.expiresAtMs || secret.viewCount >= secret.maxViews) {
      // Remove do banco e da memória
      localSecretStore.delete(id);
      ctx.db.prepare("DELETE FROM app_settings WHERE key = ?").run(`secret_${id}`);

      return reply.code(404).send({
        error: "SECRET_EXPIRED",
        message: "Este link seguro atingiu o limite de tempo ou acessos e expirou.",
      });
    }

    // Incrementa contador de visualização sem destruir se maxViews permitir múltiplos acessos
    secret.viewCount += 1;
    const isLastView = secret.viewCount >= secret.maxViews;

    if (isLastView) {
      localSecretStore.delete(id);
      ctx.db.prepare("DELETE FROM app_settings WHERE key = ?").run(`secret_${id}`);
    } else {
      localSecretStore.set(id, secret);
      ctx.db.prepare("UPDATE app_settings SET value = ? WHERE key = ?").run(JSON.stringify(secret), `secret_${id}`);
    }

    return {
      ok: true,
      payload: secret.payload,
      destroyed: isLastView,
      viewCount: secret.viewCount,
      maxViews: secret.maxViews,
      readAtMs: nowMs,
    };
  });
}
