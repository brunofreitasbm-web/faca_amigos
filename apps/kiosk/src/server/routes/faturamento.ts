import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  getUnit,
  getEmployee,
  setUnitFiscalIdentity,
  faturamentoPorDia,
  faturamentoPorNatureza,
  faturamentoPorMeioPagamento,
  cancelamentosPorDia,
  insertIntegrationApiKey,
  findIntegrationApiKeyByPrefix,
  listIntegrationApiKeys,
  revokeIntegrationApiKey,
  touchIntegrationApiKey,
  logIntegrationAccess,
  listIntegrationAccessLog,
  uuidv7,
  type IntegrationApiKeyRow,
} from "@facaamigos/db-local";
import {
  montarDeclaracao,
  declaracaoParaCsv,
  conferirDeclaracao,
  type DeclaracaoFaturamento,
  type IdentificacaoLoja,
} from "@facaamigos/domain";
import type { AppContext } from "../context.js";
import {
  criarChaveIntegracaoSchema,
  identificacaoFiscalSchema,
  periodoFaturamentoSchema,
} from "../schemas.js";
import { parseBody, parseQuery, ValidationError } from "../validate.js";
import {
  extrairChaveDoRequest,
  extrairPrefixo,
  gerarChaveApi,
  verificarChaveApi,
} from "../security/api-key.js";

/**
 * Faturamento para a administração do shopping.
 *
 * Duas famílias de rota, de propósito separadas:
 *
 * - `/api/faturamento/*` e `/api/integracao/*` — uso interno (painel,
 *   back-office). Mesma autenticação fraca do resto da Fase 1.
 * - `/integracao/shopping/v1/*` — o que a administração consome.
 *   Autenticado por chave de API, escopo somente-leitura, cada acesso
 *   registrado. Prefixo versionado (`v1`) porque o consumidor é um
 *   terceiro que não atualiza quando a gente quer.
 *
 * O que sai daqui é agregado por dia: nenhum dado de criança, de
 * responsável ou de funcionário atravessa essa fronteira. Isso é uma
 * decisão de LGPD, não uma limitação técnica — o shopping precisa de
 * quanto entrou, não de quem entrou.
 */

const ESCOPO_FATURAMENTO = "FATURAMENTO_LEITURA";

function identificacaoDaUnidade(ctx: AppContext, unitId: string): IdentificacaoLoja {
  const unit = getUnit(ctx.db, unitId);
  if (!unit) throw new ValidationError(`Unidade ${unitId} não encontrada.`);
  return {
    unidadeId: unit.id,
    nome: unit.name,
    cnpj: unit.cnpj,
    razaoSocial: unit.razao_social,
    luc: unit.shopping_luc,
    codigoLojista: unit.shopping_store_code,
    timezone: unit.timezone,
    cutoffHoraDiaOperacional: unit.business_day_cutoff_hour,
  };
}

function gerarDeclaracao(
  ctx: AppContext,
  unitId: string,
  de: string,
  ate: string,
): DeclaracaoFaturamento {
  const loja = identificacaoDaUnidade(ctx, unitId);
  return montarDeclaracao({
    loja,
    dataInicial: de,
    dataFinal: ate,
    dias: faturamentoPorDia(ctx.db, unitId, de, ate).map((r) => ({
      businessDate: r.business_date,
      ordersCount: r.orders_count,
      grossCents: r.gross_cents,
      netCents: r.net_cents,
    })),
    naturezas: faturamentoPorNatureza(ctx.db, unitId, de, ate).map((r) => ({
      businessDate: r.business_date,
      itemNature: r.item_nature,
      netCents: r.net_cents,
    })),
    meiosPagamento: faturamentoPorMeioPagamento(ctx.db, unitId, de, ate).map((r) => ({
      businessDate: r.business_date,
      method: r.method,
      totalCents: r.total_cents,
    })),
    cancelamentos: cancelamentosPorDia(ctx.db, unitId, de, ate).map((r) => ({
      businessDate: r.business_date,
      cancelledCount: r.cancelled_count,
      cancelledCents: r.cancelled_cents,
    })),
    geradoEmMs: ctx.nowMs(),
  });
}

function ipDoRequest(req: FastifyRequest): string | null {
  return req.ip ?? null;
}

export function registerFaturamentoRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---------------------------------------------------------------
  // Interno: conferência antes de declarar
  // ---------------------------------------------------------------

  app.get<{ Querystring: { unitId: string; de: string; ate: string } }>(
    "/api/faturamento/declaracao",
    async (req) => {
      const { unitId, de, ate } = parseQuery(periodoFaturamentoSchema, req.query);
      const declaracao = gerarDeclaracao(ctx, unitId, de, ate);
      // A conferência acompanha a resposta interna e não a externa: quem
      // precisa ver "falta cadastrar a LUC" é a gente, antes de enviar.
      return { declaracao, pendencias: conferirDeclaracao(declaracao) };
    },
  );

  app.put<{ Params: { unitId: string } }>(
    "/api/unidades/:unitId/identificacao-fiscal",
    async (req, reply) => {
      const body = parseBody(identificacaoFiscalSchema, req.body);
      if (!getUnit(ctx.db, req.params.unitId))
        return reply.code(404).send({ error: "UNIDADE_NAO_ENCONTRADA" });
      setUnitFiscalIdentity(ctx.db, req.params.unitId, {
        cnpj: body.cnpj ?? null,
        razaoSocial: body.razaoSocial ?? null,
        shoppingLuc: body.shoppingLuc ?? null,
        shoppingStoreCode: body.shoppingStoreCode ?? null,
      });
      return reply.code(200).send({ ok: true });
    },
  );

  // ---------------------------------------------------------------
  // Interno: gestão das chaves entregues ao shopping
  // ---------------------------------------------------------------

  app.post("/api/integracao/chaves", async (req, reply) => {
    const body = parseBody(criarChaveIntegracaoSchema, req.body);
    const employee = getEmployee(ctx.db, body.employeeId);
    // Emitir credencial para terceiro é ato de ADMIN, e aqui a
    // checagem é feita no servidor mesmo com o login fraco da Fase 1:
    // é barato, e o custo de errar é uma chave de faturamento na mão
    // errada.
    if (!employee || !employee.active || employee.role !== "ADMIN") {
      return reply
        .code(403)
        .send({ error: "PERMISSAO_NEGADA", message: "Apenas ADMIN emite chave de integração." });
    }
    if (body.unitId && !getUnit(ctx.db, body.unitId)) {
      return reply.code(404).send({ error: "UNIDADE_NAO_ENCONTRADA" });
    }

    const nowMs = ctx.nowMs();
    const { segredo, prefixo, hash } = gerarChaveApi();
    const id = uuidv7(nowMs);
    insertIntegrationApiKey(
      ctx.db,
      {
        id,
        name: body.nome,
        prefix: prefixo,
        keyHash: hash,
        scope: ESCOPO_FATURAMENTO,
        unitId: body.unitId ?? null,
        createdByEmployeeId: employee.id,
      },
      nowMs,
    );

    // `segredo` só existe nesta resposta. Não há endpoint que o
    // recupere depois — perdeu, revoga e emite outra.
    return reply
      .code(201)
      .send({ id, nome: body.nome, prefixo, segredo, escopo: ESCOPO_FATURAMENTO });
  });

  app.get("/api/integracao/chaves", async () => listIntegrationApiKeys(ctx.db));

  app.post<{ Params: { id: string } }>("/api/integracao/chaves/:id/revogar", async (req, reply) => {
    revokeIntegrationApiKey(ctx.db, req.params.id, ctx.nowMs());
    return reply.code(200).send({ ok: true });
  });

  app.get("/api/integracao/acessos", async () => listIntegrationAccessLog(ctx.db));

  // ---------------------------------------------------------------
  // Externo: o que a administração do shopping consome
  // ---------------------------------------------------------------

  /**
   * Valida a chave e devolve a linha, ou devolve null tendo já
   * respondido o erro. Registra a tentativa em qualquer desfecho —
   * inclusive a falha, que é justamente a que interessa auditar.
   */
  function autenticar(req: FastifyRequest, reply: FastifyReply): IntegrationApiKeyRow | null {
    const nowMs = ctx.nowMs();
    const rota = req.url.split("?")[0]!;
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : null;

    const negar = (status: number, erro: string, apiKeyId: string | null) => {
      logIntegrationAccess(
        ctx.db,
        { apiKeyId, route: rota, query, status, remoteIp: ipDoRequest(req) },
        nowMs,
      );
      void reply.code(status).send({ error: erro });
      return null;
    };

    const segredo = extrairChaveDoRequest(req.headers as unknown as Record<string, unknown>);
    if (!segredo) return negar(401, "CHAVE_AUSENTE", null);

    const prefixo = extrairPrefixo(segredo);
    if (!prefixo) return negar(401, "CHAVE_INVALIDA", null);

    const row = findIntegrationApiKeyByPrefix(ctx.db, prefixo);
    // Sem `row` a comparação de hash nem acontece; ainda assim a
    // resposta é a mesma de chave errada, para não confirmar a
    // existência de um prefixo a quem está tentando adivinhar.
    if (!row || !verificarChaveApi(segredo, row.key_hash))
      return negar(401, "CHAVE_INVALIDA", row?.id ?? null);
    if (row.revoked_at_ms !== null) return negar(401, "CHAVE_REVOGADA", row.id);
    if (row.scope !== ESCOPO_FATURAMENTO) return negar(403, "ESCOPO_INSUFICIENTE", row.id);

    touchIntegrationApiKey(ctx.db, row.id, nowMs);
    logIntegrationAccess(
      ctx.db,
      { apiKeyId: row.id, route: rota, query, status: 200, remoteIp: ipDoRequest(req) },
      nowMs,
    );
    return row;
  }

  /** Confirma para o shopping que a chave dele funciona, sem expor faturamento. */
  app.get("/integracao/shopping/v1/health", async (req, reply) => {
    const chave = autenticar(req, reply);
    if (!chave) return reply;
    return reply
      .code(200)
      .send({ ok: true, escopo: chave.scope, layoutVersao: "1.0", nowMs: ctx.nowMs() });
  });

  app.get<{ Querystring: { unitId?: string; de: string; ate: string; formato?: string } }>(
    "/integracao/shopping/v1/faturamento",
    async (req, reply) => {
      const chave = autenticar(req, reply);
      if (!chave) return reply;

      // Chave amarrada a uma unidade ignora `unitId` do chamador: o
      // escopo é do credenciamento, não do parâmetro.
      const unitId = chave.unit_id ?? req.query.unitId;
      if (!unitId) {
        return reply.code(400).send({
          error: "UNIDADE_NAO_INFORMADA",
          message: "Informe unitId ou use chave vinculada a uma unidade.",
        });
      }

      const { de, ate } = parseQuery(periodoFaturamentoSchema, {
        unitId,
        de: req.query.de,
        ate: req.query.ate,
      });
      const declaracao = gerarDeclaracao(ctx, unitId, de, ate);

      if ((req.query.formato ?? "json").toLowerCase() === "csv") {
        return reply
          .code(200)
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="faturamento-${de}-a-${ate}.csv"`)
          .send(declaracaoParaCsv(declaracao));
      }

      return reply.code(200).send(declaracao);
    },
  );
}
