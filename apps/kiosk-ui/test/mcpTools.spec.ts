import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { addReais, resolveUnits, validateRange } from "../api/_mcp/tools";
import { authenticateMcpRequest, extractToken } from "../api/_mcp/auth";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("validateRange", () => {
  it("aceita intervalo válido", () => expect(validateRange("2026-10-01", "2026-10-17")).toBeNull());
  it("recusa fim antes do início", () => expect(validateRange("2026-10-17", "2026-10-01")).toMatch(/anterior/));
  it("recusa intervalo maior que 366 dias", () => expect(validateRange("2025-01-01", "2026-10-17")).toMatch(/máximo/));
});

describe("resolveUnits", () => {
  it("chave global sem filtro enxerga todas", () =>
    expect(resolveUnits({ keyId: "k", unitIds: null })).toEqual({ ok: true, units: null }));
  it("chave restrita sem filtro usa o escopo", () =>
    expect(resolveUnits({ keyId: "k", unitIds: [A] })).toEqual({ ok: true, units: [A] }));
  it("recusa unidade fora do escopo", () =>
    expect(resolveUnits({ keyId: "k", unitIds: [A] }, B).ok).toBe(false));
  it("aceita unidade dentro do escopo", () =>
    expect(resolveUnits({ keyId: "k", unitIds: [A, B] }, B)).toEqual({ ok: true, units: [B] }));
});

describe("addReais", () => {
  it("acrescenta *_reais para cada *_cents, recursivamente", () => {
    expect(addReais({ total_cents: 1050, itens: [{ x_cents: 5 }] })).toEqual({
      total_cents: 1050,
      total_reais: 10.5,
      itens: [{ x_cents: 5, x_reais: 0.05 }],
    });
  });
});

describe("extractToken", () => {
  it("lê Bearer e X-API-Key", () => {
    expect(extractToken({ authorization: "Bearer abc" })).toBe("abc");
    expect(extractToken({ "x-api-key": "xyz" })).toBe("xyz");
    expect(extractToken({})).toBeNull();
  });
});

function fakeSupabase(row: unknown) {
  const update = vi.fn(() => ({ eq: vi.fn() }));
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select, update }));
  return { client: { from } as never, eq };
}

describe("authenticateMcpRequest", () => {
  it("sem chave → 401 CHAVE_AUSENTE", async () => {
    const { client } = fakeSupabase(null);
    expect(await authenticateMcpRequest(client, {})).toEqual({ ok: false, status: 401, error: "CHAVE_AUSENTE" });
  });
  it("chave desconhecida → CHAVE_INVALIDA", async () => {
    const { client } = fakeSupabase(null);
    expect(await authenticateMcpRequest(client, { authorization: "Bearer x" })).toMatchObject({ error: "CHAVE_INVALIDA" });
  });
  it("chave revogada → CHAVE_REVOGADA", async () => {
    const { client } = fakeSupabase({ id: "k", unit_ids: null, revoked_at: "2026-01-01" });
    expect(await authenticateMcpRequest(client, { authorization: "Bearer x" })).toMatchObject({ error: "CHAVE_REVOGADA" });
  });
  it("consulta pelo hash sha256, nunca pelo texto da chave", async () => {
    const { client, eq } = fakeSupabase({ id: "k", unit_ids: [A], revoked_at: null });
    const r = await authenticateMcpRequest(client, { authorization: "Bearer segredo" });
    expect(eq).toHaveBeenCalledWith("key_hash", createHash("sha256").update("segredo").digest("hex"));
    expect(r).toEqual({ ok: true, scope: { keyId: "k", unitIds: [A] } });
  });
});

describe("servidor MCP (in-memory)", () => {
  async function connect(scope: { keyId: string; unitIds: string[] | null }, rpcData: unknown = { total_cents: 1000 }) {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { registerTools } = await import("../api/_mcp/tools");
    const rpc = vi.fn(async () => ({ data: rpcData, error: null }));
    const server = new McpServer({ name: "t", version: "0" });
    registerTools(server, { rpc } as never, scope);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0" });
    await Promise.all([server.connect(st), client.connect(ct)]);
    return { client, rpc };
  }

  it("expõe as 9 tools, todas somente-leitura", async () => {
    const { client } = await connect({ keyId: "k", unitIds: null });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["caixa", "faturamento", "fidelidade", "listar_unidades", "metas", "nps", "ocupacao_agora", "produtos", "sessoes"].sort(),
    );
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("repassa o escopo da chave à RPC e acrescenta *_reais", async () => {
    const { client, rpc } = await connect({ keyId: "k", unitIds: [A] });
    const r = await client.callTool({ name: "faturamento", arguments: { inicio: "2026-10-01", fim: "2026-10-07" } });
    expect(rpc).toHaveBeenCalledWith("fa_mcp_faturamento", { p_inicio: "2026-10-01", p_fim: "2026-10-07", p_units: [A] });
    expect(JSON.stringify(r.content)).toContain("total_reais");
  });

  it("recusa unit_id fora do escopo sem chamar o banco", async () => {
    const { client, rpc } = await connect({ keyId: "k", unitIds: [A] });
    const r = await client.callTool({ name: "ocupacao_agora", arguments: { unit_id: B } });
    expect(r.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recusa intervalo inválido", async () => {
    const { client, rpc } = await connect({ keyId: "k", unitIds: null });
    const r = await client.callTool({ name: "nps", arguments: { inicio: "2026-10-10", fim: "2026-10-01" } });
    expect(r.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
