import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------
// Mocks hoistados (vi.mock é movido para o topo do arquivo pelo Vitest, e
// os valores que as factories referenciam precisam existir antes disso).
// ---------------------------------------------------------------------
const {
  autorizarMock,
  consultarPorChaveMock,
  svrsCtorMock,
  buscarCredenciaisFiscaisMock,
  extrairChaveECertificadoPemMock,
  readCredentialsMock,
  montarXmlNfceMock,
  assinarXmlNfceMock,
} = vi.hoisted(() => ({
  autorizarMock: vi.fn(),
  consultarPorChaveMock: vi.fn(),
  svrsCtorMock: vi.fn(),
  buscarCredenciaisFiscaisMock: vi.fn(),
  extrairChaveECertificadoPemMock: vi.fn(),
  readCredentialsMock: vi.fn(),
  montarXmlNfceMock: vi.fn(),
  assinarXmlNfceMock: vi.fn(),
}));

vi.mock("@facaamigos/fiscal/svrs-transport", () => {
  class SvrsNfceTransportMock {
    autorizar: typeof autorizarMock;
    consultarPorChave: typeof consultarPorChaveMock;
    constructor(...args: unknown[]) {
      svrsCtorMock(...args);
      this.autorizar = autorizarMock;
      this.consultarPorChave = consultarPorChaveMock;
    }
  }
  return { SvrsNfceTransport: SvrsNfceTransportMock };
});

vi.mock("../src/fiscal/certificado.js", () => ({
  buscarCredenciaisFiscais: buscarCredenciaisFiscaisMock,
}));

vi.mock("../src/fiscal/vault.js", () => ({
  extrairChaveECertificadoPem: extrairChaveECertificadoPemMock,
  readCredentials: readCredentialsMock,
}));

// Mantém o resto de "@facaamigos/fiscal" real (URLS_NFCE_PA,
// gerarChaveAcessoNfceOuFallback, anoMesLocal etc., usados tanto por
// claim.ts quanto transitivamente por nfse.ts) — só monta/assina o XML da
// NFC-e são substituídos, porque exigiriam um certificado de verdade.
vi.mock("@facaamigos/fiscal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@facaamigos/fiscal")>();
  return {
    ...actual,
    montarXmlNfce: montarXmlNfceMock,
    assinarXmlNfce: assinarXmlNfceMock,
  };
});

import { processarNfceReal, runFiscalClaimOnce, type ClaimDeps } from "../src/fiscal/claim.js";

const CHAVE_TESTE = "15260812345678000199650010000001231234567890";
const QRCODE_TESTE = "https://consulta.example/nfce?p=abc";

function createSupabaseMock(opts: { reserveNumberResult?: { data: unknown; error: unknown } } = {}) {
  const updateEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });
  const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
  const fromMock = vi.fn().mockReturnValue({ update: updateMock, insert: insertMock });
  const rpcMock = vi.fn().mockResolvedValue(opts.reserveNumberResult ?? { data: 42, error: null });
  const uploadMock = vi.fn().mockResolvedValue({ data: { path: "x" }, error: null });
  const storageFromMock = vi.fn().mockReturnValue({ upload: uploadMock });
  const supabase = {
    from: fromMock,
    rpc: rpcMock,
    storage: { from: storageFromMock },
  } as unknown as SupabaseClient;
  return { supabase, fromMock, updateMock, updateEqMock, insertMock, rpcMock, uploadMock, storageFromMock };
}

function makeItem(
  overrides: {
    doc?: Record<string, unknown>;
    order?: Record<string, unknown>;
    unit?: Record<string, unknown>;
    items?: Array<Record<string, unknown>>;
    payments?: Array<Record<string, unknown>>;
  } = {},
): any {
  return {
    doc: {
      id: "doc-1",
      docType: "NFCE",
      environment: "HOMOLOGACAO",
      status: "PENDENTE",
      emissionType: "NORMAL",
      serie: "1",
      rpsSerie: null,
      numero: 10,
      accessKey: null,
      qrcodeUrl: null,
      attempts: 1,
      totalCents: 5000,
      ...overrides.doc,
    },
    order: {
      id: "order-1",
      orderCode: "FA-001",
      businessDate: "2026-09-01",
      closedAtMs: Date.now(),
      fiscalCpf: null,
      fiscalNome: null,
      fiscalEmail: null,
      ...overrides.order,
    },
    unit: {
      id: "unit-1",
      cnpj: "12345678000199",
      razaoSocial: "FAÇA AMIGOS LTDA",
      nomeFantasia: "FAÇA AMIGOS",
      inscricaoEstadual: "150000000",
      crt: 1,
      endLogradouro: "Av Presidente Vargas",
      endNumero: "100",
      endComplemento: null,
      endBairro: "Campina",
      endMunicipioIbge: "1501402",
      endMunicipioNome: "BELEM",
      endUf: "PA",
      endCep: "66000000",
      fone: null,
      timezone: "America/Belem",
      nfceSerie: 1,
      fiscalAmbiente: "HOMOLOGACAO",
      nfceCscId: "1",
      nfceQrcodeUrlConsulta: null,
      ...overrides.unit,
    },
    items: overrides.items ?? [
      {
        description: "Café Expresso",
        quantity: 1,
        unitPriceCents: 5000,
        totalCents: 5000,
        productId: "p1",
        ncm: "21069090",
        cest: null,
        cfop: "5102",
        csosn: "102",
        origem: 0,
        unidadeComercial: "UN",
        gtin: "SEM GTIN",
        pisCst: "49",
        cofinsCst: "49",
        fiscalReady: true,
      },
    ],
    payments: overrides.payments ?? [{ method: "PIX", amountCents: 5000 }],
  };
}

describe("runFiscalClaimOnce (Modo SIMULADO)", () => {
  it("processa e autoriza documento na fila em modo SIMULADO", async () => {
    const updateEqMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });

    const claimedDoc = {
      doc: {
        id: "doc-12345",
        docType: "NFCE",
        environment: "HOMOLOGACAO" as const,
        status: "PENDENTE",
        emissionType: "NORMAL",
        serie: "1",
        numero: 100,
        accessKey: null,
        attempts: 0,
        totalCents: 5000,
      },
      order: { id: "order-1", orderCode: "FA-001", businessDate: "2026-08-27" },
      unit: { id: "unit-1", cnpj: "12345678000199" },
      items: [{ description: "Café Expresso", quantity: 1, unitPriceCents: 5000, totalCents: 5000 }],
      payments: [{ method: "PIX", amountCents: 5000 }],
    };

    const rpcMock = vi.fn().mockResolvedValue({
      data: [claimedDoc],
      error: null,
    });

    const fakeSupabase = {
      rpc: rpcMock,
      from: fromMock,
    } as unknown as SupabaseClient;

    const logs: string[] = [];
    const count = await runFiscalClaimOnce({
      supabase: fakeSupabase,
      terminalId: "test-terminal-01",
      simulado: true,
      onLog: (msg) => logs.push(msg),
    });

    expect(count).toBe(1);
    expect(rpcMock).toHaveBeenCalledWith("fa_fiscal_claim_next", {
      p_terminal_id: "test-terminal-01",
      p_limit: 5,
    });

    expect(fromMock).toHaveBeenCalledWith("fa_kiosk_fiscal_docs");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "AUTORIZADO",
        serie: "1",
        numero: 100,
      })
    );
    expect(updateEqMock).toHaveBeenCalledWith("id", "doc-12345");
    expect(logs.some((l) => l.includes("autorizado (SIMULADO)"))).toBe(true);
  });

  it("trata falha de rpc graciosamente retornando 0", async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Erro de banco de dados" },
    });

    const fakeSupabase = {
      rpc: rpcMock,
    } as unknown as SupabaseClient;

    const logs: string[] = [];
    const count = await runFiscalClaimOnce({
      supabase: fakeSupabase,
      terminalId: "test-terminal-01",
      simulado: true,
      onLog: (msg) => logs.push(msg),
    });

    expect(count).toBe(0);
    expect(logs.some((l) => l.includes("fa_fiscal_claim_next falhou"))).toBe(true);
  });
});

describe("processarNfceReal", () => {
  beforeEach(() => {
    svrsCtorMock.mockClear();
    autorizarMock.mockReset().mockResolvedValue({
      autorizado: true,
      cstat: "100",
      xmotivo: "Autorizado o uso da NF-e",
      protocolo: "135260000001234",
      xmlAutorizado: "<nfeProc>...</nfeProc>",
    });
    consultarPorChaveMock.mockReset().mockResolvedValue({
      autorizado: false,
      cstat: "217",
      xmotivo: "NF-e não consta na base de dados da SEFAZ",
      protocolo: null,
      xmlAutorizado: null,
    });
    buscarCredenciaisFiscaisMock.mockReset().mockResolvedValue({
      ok: true,
      credenciais: { pfxBuffer: Buffer.from("pfx-bytes"), password: "senha", cscId: "5", cscToken: "csc-token" },
    });
    extrairChaveECertificadoPemMock.mockReset().mockReturnValue({ certPem: "CERT", privateKeyPem: "KEY" });
    readCredentialsMock.mockReset().mockReturnValue(null);
    montarXmlNfceMock.mockReset().mockReturnValue({ xml: "<NFe/>", chaveAcesso: CHAVE_TESTE, qrCodeUrl: QRCODE_TESTE });
    assinarXmlNfceMock.mockReset().mockReturnValue("<NFe>assinado</NFe>");
  });

  it("bloqueia quando falta campo obrigatório do emitente (endMunicipioNome) e não chega a construir o transporte", async () => {
    const item = makeItem({ unit: { endMunicipioNome: null } });
    const { supabase, updateMock, updateEqMock } = createSupabaseMock();

    await processarNfceReal({ supabase, terminalId: "t1", simulado: false } as ClaimDeps, item);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "BLOQUEADO", last_error: expect.stringContaining("Nome do Município") }),
    );
    expect(updateEqMock).toHaveBeenCalledWith("id", item.doc.id);
    expect(svrsCtorMock).not.toHaveBeenCalled();
    expect(buscarCredenciaisFiscaisMock).not.toHaveBeenCalled();
  });

  it("bloqueia nomeando o produto quando um item não está pronto para NFC-e (fiscalReady=false)", async () => {
    const item = makeItem({
      items: [
        {
          description: "Brinde Promocional",
          quantity: 1,
          unitPriceCents: 500,
          totalCents: 500,
          productId: "p2",
          ncm: null,
          cest: null,
          cfop: null,
          csosn: null,
          origem: null,
          unidadeComercial: null,
          gtin: null,
          pisCst: null,
          cofinsCst: null,
          fiscalReady: false,
        },
      ],
    });
    const { supabase, updateMock } = createSupabaseMock();

    await processarNfceReal({ supabase, terminalId: "t1", simulado: false } as ClaimDeps, item);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "BLOQUEADO", last_error: expect.stringContaining("Brinde Promocional") }),
    );
    expect(svrsCtorMock).not.toHaveBeenCalled();
  });

  it("descarta (não bloqueia) um documento sem nenhum item de produto", async () => {
    const item = makeItem({ items: [] });
    const { supabase, updateMock } = createSupabaseMock();

    await processarNfceReal({ supabase, terminalId: "t1", simulado: false } as ClaimDeps, item);

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "DESCARTADO" }));
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ status: "BLOQUEADO" }));
    expect(svrsCtorMock).not.toHaveBeenCalled();
  });

  it("reserva numeração via fa_fiscal_reserve_number quando doc.numero é null, e usa o número reservado", async () => {
    const item = makeItem({ doc: { numero: null } });
    const { supabase, rpcMock, updateMock } = createSupabaseMock({ reserveNumberResult: { data: 777, error: null } });

    await processarNfceReal({ supabase, terminalId: "t1", simulado: false } as ClaimDeps, item);

    expect(rpcMock).toHaveBeenCalledWith(
      "fa_fiscal_reserve_number",
      expect.objectContaining({ p_unit_id: item.unit.id, p_doc_type: "NFCE", p_environment: item.doc.environment, p_serie: "1" }),
    );
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "ASSINADO", numero: 777 }));
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "AUTORIZADO" }));
  });

  it("não reserva numeração quando o documento já tem doc.numero", async () => {
    const item = makeItem({ doc: { numero: 55 } });
    const { supabase, rpcMock } = createSupabaseMock();

    await processarNfceReal({ supabase, terminalId: "t1", simulado: false } as ClaimDeps, item);

    expect(rpcMock).not.toHaveBeenCalledWith("fa_fiscal_reserve_number", expect.anything());
  });

  it("consulta por chave antes de retransmitir quando o documento já tem access_key; autorizada, não chama autorizar de novo", async () => {
    consultarPorChaveMock.mockResolvedValueOnce({
      autorizado: true,
      cstat: "100",
      xmotivo: "Autorizado o uso da NF-e",
      protocolo: "999888777",
      xmlAutorizado: "<nfeProc/>",
    });
    const item = makeItem({ doc: { numero: 10, accessKey: CHAVE_TESTE, qrcodeUrl: "https://consulta.example/ja-existente" } });
    const { supabase, updateMock } = createSupabaseMock();

    await processarNfceReal({ supabase, terminalId: "t1", simulado: false } as ClaimDeps, item);

    expect(consultarPorChaveMock).toHaveBeenCalledWith(CHAVE_TESTE, item.doc.environment);
    expect(autorizarMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "AUTORIZADO", protocol_number: "999888777" }));
  });

  it("caminho feliz: autoriza, grava protocolo real (não o fake antigo) e enfileira impressão com QR fiscal", async () => {
    const item = makeItem({});
    const { supabase, updateMock, insertMock } = createSupabaseMock();

    await processarNfceReal({ supabase, terminalId: "t1", simulado: false, deviceId: "dev-1" } as ClaimDeps, item);

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "ASSINADO", access_key: CHAVE_TESTE, qrcode_url: QRCODE_TESTE }));
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "AUTORIZADO", protocol_number: "135260000001234" }));
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ protocol_number: "153260000000000" }));

    const printCall = insertMock.mock.calls.find((c) => (c[0] as any)?.payload_json?.fiscalQrUrl);
    expect(printCall).toBeTruthy();
    const payload = (printCall![0] as any).payload_json;
    expect(payload.fiscalAccessKey).toBe(CHAVE_TESTE);
    expect(payload.fiscalProtocol).toBe("135260000001234");
    expect(payload.title).toBe("DANFE NFC-e");
  });

  it("grava REJEITADO (não BLOQUEADO) com reject_code/reject_message quando a SVRS rejeita a NFC-e", async () => {
    autorizarMock.mockResolvedValueOnce({
      autorizado: false,
      cstat: "539",
      xmotivo: "Duplicidade de NF-e",
      protocolo: null,
      xmlAutorizado: null,
    });
    const item = makeItem({});
    const { supabase, updateMock } = createSupabaseMock();

    await processarNfceReal({ supabase, terminalId: "t1", simulado: false } as ClaimDeps, item);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "REJEITADO", reject_code: "539", reject_message: "Duplicidade de NF-e" }),
    );
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ status: "BLOQUEADO" }));
  });

  it("bloqueia pagamento VOUCHER sem mapeamento fiscal, sem chegar a montar o XML", async () => {
    const item = makeItem({ payments: [{ method: "VOUCHER", amountCents: 5000 }] });
    const { supabase, updateMock } = createSupabaseMock();

    await processarNfceReal({ supabase, terminalId: "t1", simulado: false } as ClaimDeps, item);

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "BLOQUEADO", last_error: expect.stringContaining("Voucher") }));
    expect(montarXmlNfceMock).not.toHaveBeenCalled();
  });

  it("bloqueia com o motivo exato quando não há credenciais fiscais disponíveis", async () => {
    buscarCredenciaisFiscaisMock.mockResolvedValueOnce({
      ok: false,
      motivo: "Certificado A1 não disponível: não configurado em Configurações → Fiscal",
    });
    const item = makeItem({});
    const { supabase, updateMock } = createSupabaseMock();

    await processarNfceReal({ supabase, terminalId: "t1", simulado: false } as ClaimDeps, item);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "BLOQUEADO", last_error: "Certificado A1 não disponível: não configurado em Configurações → Fiscal" }),
    );
    expect(extrairChaveECertificadoPemMock).not.toHaveBeenCalled();
    expect(svrsCtorMock).not.toHaveBeenCalled();
  });
});
