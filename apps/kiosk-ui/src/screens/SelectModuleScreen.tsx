import { Card, Button, Badge, BrandLockup } from "@facaamigos/ui";
import { UNIT_BRANDS, unitMatchesBrand } from "../branding/unitBrand.js";
import { useAppState } from "../state/AppState.js";
import { useAuth } from "../auth/AuthContext.js";
import { useMobileShell } from "../mobile/useMobileShell.js";

/**
 * Tela Principal de Seleção de Módulo:
 * - No Desktop/Totem: layout expandido com grid completo, cartões grandes, badges e botões de ação.
 * - No Mobile: layout compacto (zero scroll) otimizado para a viewport do celular do operador/dono.
 */
export function SelectModuleScreen() {
  const { units, setUnitId, setGerencial, employee } = useAppState();
  const { can } = useAuth();
  const mobile = useMobileShell();

  const isOperador = employee?.role === "OPERADOR";
  const isOwner = !isOperador && can("config.write");

  const displayModules = UNIT_BRANDS.filter((mod) => {
    if (!isOperador) return true;
    return units.some((u) => unitMatchesBrand(mod.key, u.name));
  }).map((mod) => {
    const matchedUnit = units.find((u) => unitMatchesBrand(mod.key, u.name));
    return {
      ...mod,
      unitId: matchedUnit?.id || mod.key,
    };
  });

  // ==========================================
  // LAYOUT MOBILE (COMPACTO / ZERO SCROLL)
  // ==========================================
  if (mobile.active) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "var(--surface-page, #F8FAFC)",
          padding: "14px 14px 18px",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {/* Topo Compacto */}
        <div style={{ textAlign: "center", marginBottom: "8px", flexShrink: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
            <img src="/favicon.png" alt="FaçaAmigos" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: "16px", color: "var(--color-primary, #F0196B)", fontWeight: 700 }}>
              FaçaAmigos
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted, #64748B)", fontWeight: 700 }}>
            Selecione a operação para iniciar
          </p>
        </div>

        {/* Grid Compacto de Cards (3 operações + 1 gerencial unificado) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            width: "100%",
            maxWidth: "460px",
            margin: "0 auto",
            flex: 1,
            justifyContent: "center",
          }}
        >
          {displayModules.map((meta) => (
            <div
              key={meta.key}
              onClick={() => setUnitId(meta.unitId)}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 14px",
                borderRadius: "16px",
                background: "var(--surface-card, #FFFFFF)",
                border: "1px solid var(--border-subtle, rgba(0,0,0,0.06))",
                borderLeft: `5px solid ${meta.accent}`,
                boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                cursor: "pointer",
                gap: "10px",
                minHeight: "56px",
                boxSizing: "border-box",
                transition: "transform 0.1s ease, box-shadow 0.1s ease",
              }}
            >
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "10px",
                  background: "var(--surface-sunken, #F1F5F9)",
                  color: meta.accent,
                  fontSize: "20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {meta.icon}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                  <h2
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "14.5px",
                      margin: 0,
                      color: "var(--text-primary, #0F172A)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      lineHeight: 1.2,
                    }}
                  >
                    {meta.title}
                  </h2>
                  <Badge variant={meta.badge}>{meta.location}</Badge>
                </div>
                <p
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: meta.accent,
                    margin: "2px 0 0",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {meta.subtitle}
                </p>
              </div>

              <span style={{ fontSize: "16px", color: "var(--text-muted, #94A3B8)", fontWeight: 700, flexShrink: 0 }}>
                ›
              </span>
            </div>
          ))}

          {isOwner && (
            <div
              key="gerencial-compacto"
              onClick={() => setGerencial(true)}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 14px",
                borderRadius: "16px",
                background: "linear-gradient(135deg, #FFFFFF 0%, rgba(46, 207, 181, 0.07) 100%)",
                border: "1.5px solid rgba(46, 207, 181, 0.35)",
                borderLeft: "5px solid var(--color-primary, #F0196B)",
                boxShadow: "0 2px 8px rgba(46, 207, 181, 0.08)",
                cursor: "pointer",
                gap: "10px",
                minHeight: "56px",
                boxSizing: "border-box",
                marginTop: "2px",
              }}
            >
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "10px",
                  background: "rgba(46, 207, 181, 0.12)",
                  fontSize: "18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                📊
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                  <h2
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "14.5px",
                      margin: 0,
                      color: "var(--text-primary, #0F172A)",
                      lineHeight: 1.2,
                    }}
                  >
                    Painel Gerencial
                  </h2>
                  <Badge variant="vip">Owner</Badge>
                </div>
                <p
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "var(--color-primary, #F0196B)",
                    margin: "2px 0 0",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Metas do Dia · NPS (+94) · Visão das 3 Lojas
                </p>
              </div>

              <span style={{ fontSize: "18px", fontWeight: 800, color: "var(--color-primary, #F0196B)", flexShrink: 0 }}>
                ›
              </span>
            </div>
          )}
        </div>

        {/* Rodapé Ultra-Enxuto */}
        <div style={{ textAlign: "center", marginTop: "8px", flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: "11px", fontWeight: 600, color: "var(--text-muted, #94A3B8)" }}>
            {employee?.full_name ? `${employee.full_name} · Conectado` : "Sistema Operacional FaçaAmigos"}
          </p>
        </div>
      </div>
    );
  }

  // ==========================================
  // LAYOUT DESKTOP / BALCÃO (EXPANDIDO)
  // ==========================================
  return (
    <div
      style={{
        minHeight: "calc(100vh - 60px)",
        background: "linear-gradient(135deg, var(--surface-page, #F8FAFC) 0%, rgba(46, 207, 181, 0.08) 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: "600px", marginBottom: "36px" }}>
        <BrandLockup size="lg" style={{ justifyContent: "center", marginBottom: "16px" }} />
        <p style={{ fontSize: "20px", color: "var(--text-primary)", fontWeight: "bold", margin: "0 0 8px 0" }}>
          Sistema Operacional — Seleção de Módulo
        </p>
        <p style={{ fontSize: "15px", color: "var(--text-muted)", margin: 0 }}>
          Selecione abaixo o módulo da sua operação para iniciar os atendimentos.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
          gap: "24px",
          width: "100%",
          maxWidth: "1140px",
        }}
      >
        {displayModules.map((meta) => (
          <Card
            key={meta.key}
            onClick={() => setUnitId(meta.unitId)}
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "28px",
              borderRadius: "24px",
              border: "2px solid var(--border-subtle, rgba(0,0,0,0.06))",
              borderTop: `6px solid ${meta.accent}`,
              background: "var(--surface-card, #FFFFFF)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
              transition: "transform 0.2s ease, box-shadow 0.2s ease",
              cursor: "pointer",
              position: "relative",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
              <div
                style={{
                  fontSize: "38px",
                  lineHeight: 1,
                  background: "var(--surface-sunken, #F1F5F9)",
                  padding: "12px",
                  borderRadius: "18px",
                  color: meta.accent,
                }}
              >
                {meta.icon}
              </div>
              <Badge variant={meta.badge}>{meta.location}</Badge>
            </div>

            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: "0 0 6px 0", color: "var(--text-primary)" }}>
              {meta.title}
            </h2>

            <p style={{ fontSize: "14px", fontWeight: "bold", color: meta.accent, margin: "0 0 24px 0", flex: 1 }}>
              {meta.subtitle}
            </p>

            <Button
              variant="primary"
              size="md"
              onClick={() => setUnitId(meta.unitId)}
              style={{
                width: "100%",
                borderRadius: "9999px",
                fontWeight: "bold",
              }}
            >
              Acessar Operação ➔
            </Button>
          </Card>
        ))}

        {isOwner && (
          <Card
            key="gerencial"
            onClick={() => setGerencial(true)}
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "28px",
              borderRadius: "24px",
              border: "2px solid rgba(46, 207, 181, 0.3)",
              borderTop: "6px solid var(--color-primary, #F0196B)",
              background: "var(--surface-card, #FFFFFF)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
              transition: "transform 0.2s ease, box-shadow 0.2s ease",
              cursor: "pointer",
              position: "relative",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
              <div
                style={{
                  fontSize: "38px",
                  lineHeight: 1,
                  background: "rgba(46, 207, 181, 0.12)",
                  padding: "12px",
                  borderRadius: "18px",
                }}
              >
                📊
              </div>
              <Badge variant="vip">Owner</Badge>
            </div>

            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: "0 0 6px 0", color: "var(--text-primary)" }}>
              Painel Gerencial
            </h2>

            <p style={{ fontSize: "14px", fontWeight: "bold", color: "var(--color-primary, #F0196B)", margin: "0 0 10px 0" }}>
              Metas do Dia, NPS (+94) e Visão das 3 Lojas
            </p>

            <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 24px 0", flex: 1 }}>
              Faturamento das unidades frente à meta diária, acompanhamento executivo de NPS e configurações globais da rede.
            </p>

            <Button
              variant="primary"
              size="md"
              onClick={() => setGerencial(true)}
              style={{ width: "100%", borderRadius: "9999px", fontWeight: "bold" }}
            >
              Entrar no Gerencial ➔
            </Button>
          </Card>
        )}
      </div>

      <div style={{ textAlign: "center", marginTop: "32px" }}>
        <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "var(--text-muted)" }}>
          {employee?.full_name ? `${employee.full_name} · Conectado` : "Sistema Operacional FaçaAmigos"}
        </p>
      </div>
    </div>
  );
}
