import { Badge, Card } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { PageTitle } from "@/components/Typography";

/**
 * Painel fiscal (Fase 1 do plano) — por ora só o semáforo do terminal
 * (heartbeat, M3 do plano: "o que transforma risco silencioso em problema
 * visível") e o resumo do dia. A emissão de verdade é Fase 5/6, ainda não
 * implementada; enquanto isso esta tela mostra sobretudo "nada configurado
 * ainda", o que é o estado correto.
 */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const HEARTBEAT_STALE_MS = 30 * 60 * 1000; // 30 min — mesmo limiar do alerta do plano (M3)
const CERT_EXPIRING_SOON_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

interface TerminalStatus {
  unit_id: string;
  terminal_id: string;
  worker_version: string | null;
  cert_subject_cn: string | null;
  cert_cnpj: string | null;
  cert_not_after_ms: number | null;
  csc_configured: boolean;
  environment: string | null;
  last_heartbeat_ms: number;
  last_error: string | null;
}

interface PendingSummary {
  businessDate: string;
  salesWithProduct: number;
  authorized: number;
  pending: number;
  contingency: number;
  blocked: number;
  rejected: number;
}

export default async function FiscalPage() {
  const supabase = await createClient();
  const nowMs = Date.now();
  const businessDate = today();

  const [{ data: units }, { data: statuses }] = await Promise.all([
    supabase.from("fa_kiosk_units").select("id, name, fiscal_enabled").order("name"),
    supabase.from("fa_kiosk_fiscal_terminal_status").select("*"),
  ]);

  const statusByUnit = new Map((statuses as TerminalStatus[] | null ?? []).map((s) => [s.unit_id, s]));

  const summaries = await Promise.all(
    (units ?? []).map(async (u) => {
      const { data } = await supabase.rpc("fa_fiscal_pending_summary", {
        p_unit_id: u.id,
        p_business_date: businessDate,
      });
      return { unitId: u.id, summary: (data as PendingSummary | null) ?? null };
    }),
  );
  const summaryByUnit = new Map(summaries.map((s) => [s.unitId, s.summary]));

  return (
    <div>
      <PageTitle>Fiscal</PageTitle>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "14px",
          color: "var(--text-muted)",
          marginTop: "-8px",
          marginBottom: "var(--space-5)",
        }}
      >
        Status do emissor de NFC-e no PC do balcão e cobertura das vendas de produto de hoje. Dados
        fiscais do emitente e dos produtos ficam em Unidades e Produtos.
      </p>

      {(units ?? []).map((u) => {
        const status = statusByUnit.get(u.id);
        const summary = summaryByUnit.get(u.id);
        const heartbeatAgeMs = status ? nowMs - status.last_heartbeat_ms : null;
        const isStale = heartbeatAgeMs === null || heartbeatAgeMs > HEARTBEAT_STALE_MS;
        const certExpiringSoon =
          status?.cert_not_after_ms != null && status.cert_not_after_ms - nowMs < CERT_EXPIRING_SOON_MS;
        const certExpired = status?.cert_not_after_ms != null && status.cert_not_after_ms < nowMs;

        return (
          <Card key={u.id} variant="light" title={u.name} style={{ marginBottom: "var(--space-5)" }}>
            {!u.fiscal_enabled ? (
              <Badge variant="neutral">Emissão de NFC-e desligada nesta unidade</Badge>
            ) : !status ? (
              <Badge variant="amber">Nenhum terminal reportou ainda</Badge>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {isStale ? (
                    <Badge variant="amber">
                      Emissor sem contato{" "}
                      {heartbeatAgeMs !== null ? `há ${Math.round(heartbeatAgeMs / 60000)} min` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="green">Emissor ativo</Badge>
                  )}
                  {certExpired && <Badge variant="amber">Certificado vencido</Badge>}
                  {!certExpired && certExpiringSoon && <Badge variant="amber">Certificado vence em breve</Badge>}
                  {!status.csc_configured && <Badge variant="amber">CSC não configurado no terminal</Badge>}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-secondary)" }}>
                  Terminal: {status.terminal_id} · Ambiente: {status.environment ?? "—"}
                  <br />
                  Certificado: {status.cert_subject_cn ?? "—"}
                  {status.cert_not_after_ms &&
                    ` · válido até ${new Date(status.cert_not_after_ms).toLocaleDateString("pt-BR")}`}
                  {status.last_error && (
                    <>
                      <br />
                      <span style={{ color: "var(--color-error, #c0392b)" }}>Erro: {status.last_error}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {summary && summary.salesWithProduct > 0 && (
              <div
                style={{
                  marginTop: "var(--space-3)",
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                }}
              >
                Hoje: {summary.salesWithProduct} vendas de produto · {summary.authorized} notas autorizadas
                {summary.pending > 0 && ` · ${summary.pending} pendentes`}
                {summary.contingency > 0 && ` · ${summary.contingency} em contingência`}
                {summary.blocked > 0 && ` · ${summary.blocked} bloqueadas`}
                {summary.rejected > 0 && ` · ${summary.rejected} rejeitadas`}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
