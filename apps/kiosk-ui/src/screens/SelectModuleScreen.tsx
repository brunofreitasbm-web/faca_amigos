import { Badge } from "@facaamigos/ui";
import { UNIT_BRANDS, unitMatchesBrand } from "../branding/unitBrand.js";
import { useAppState } from "../state/AppState.js";
import { useAuth } from "../auth/AuthContext.js";

/**
 * Tela Principal de Seleção de Módulo — Versão Ultra-Compacta (Zero Scroll).
 * Otimizada especificamente para caber 100% na viewport mobile sem rolagem,
 * reunindo os 3 módulos operacionais + 1 card único do Gerencial (Metas + NPS).
 */
export function SelectModuleScreen() {
  const { units, setUnitId, setGerencial, employee } = useAppState();
  const { can } = useAuth();

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
      {/* 1. TOPO COMPACTO */}
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

      {/* 2. GRID COMPACTO DE CARDS (3 OPERAÇÕES + 1 GERENCIAL UNIFICADO) */}
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
        {displayModules.map((meta) => {
          return (
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
                  <Badge variant={meta.badge}>{meta.location.replace(" Belém", "")}</Badge>
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
                  {meta.subtitle.split("—")[0]?.trim()}
                </p>
              </div>

              <span style={{ fontSize: "18px", fontWeight: 800, color: "var(--color-gray-300, #CBD5E1)", flexShrink: 0 }}>
                ›
              </span>
            </div>
          );
        })}

        {/* CARD ÚNICO DO GERENCIAL (METAS + NPS + 3 UNIDADES) */}
        {isOwner && (
          <div
            key="gerencial-unificado"
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

      {/* 3. RODAPÉ ULTRA-ENXUTO */}
      <div style={{ textAlign: "center", marginTop: "8px", flexShrink: 0 }}>
        <p style={{ margin: 0, fontSize: "11px", fontWeight: 600, color: "var(--text-muted, #94A3B8)" }}>
          {employee?.full_name ? `${employee.full_name} · Conectado` : "Sistema Operacional FaçaAmigos"}
        </p>
      </div>
    </div>
  );
}
