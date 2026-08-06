import { Card, Button, Badge, BrandLockup } from "@facaamigos/ui";
import { UNIT_BRANDS, unitMatchesBrand } from "../branding/unitBrand.js";
import { useAppState } from "../state/AppState.js";

export function SelectModuleScreen() {
  const { units, setUnitId } = useAppState();

  const displayModules = UNIT_BRANDS.map((mod) => {
    const matchedUnit = units.find((u) => unitMatchesBrand(mod.key, u.name));
    return {
      ...mod,
      unitId: matchedUnit?.id || mod.key,
    };
  });

  return (
    <div
      style={{
        minHeight: "calc(100vh - 60px)",
        background: "linear-gradient(135deg, var(--surface-page) 0%, rgba(46, 207, 181, 0.08) 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: "600px", marginBottom: "36px" }}>
        <BrandLockup size="lg" style={{ justifyContent: "center", marginBottom: "16px" }} />
        <p style={{ fontSize: "18px", color: "var(--text-primary)", fontWeight: "bold", margin: "0 0 8px 0" }}>
          Sistema Operacional — Seleção de Módulo
        </p>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: 0 }}>
          Selecione abaixo o módulo da sua operação para iniciar os atendimentos.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "24px",
          width: "100%",
          maxWidth: "1080px",
        }}
      >
        {displayModules.map((meta) => {
          return (
            <Card
              key={meta.key}
              onClick={() => setUnitId(meta.unitId)}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "24px",
                borderRadius: "24px",
                border: "2px solid var(--border-subtle)",
                // Régua da operação também no cartão: é a mesma cor que
                // vai ficar no topo do sistema depois de entrar.
                borderTop: `6px solid ${meta.accent}`,
                transition: "all 0.25s ease",
                cursor: "pointer",
                position: "relative",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div
                  style={{
                    fontSize: "42px",
                    lineHeight: 1,
                    background: "var(--surface-sunken)",
                    padding: "12px",
                    borderRadius: "16px",
                  }}
                >
                  {meta.icon}
                </div>
                <Badge variant={meta.badge}>{meta.location}</Badge>
              </div>

              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: "0 0 6px 0", color: "var(--text-primary)" }}>
                {meta.title}
              </h2>

              <p style={{ fontSize: "14px", fontWeight: "bold", color: meta.accent, margin: "0 0 12px 0" }}>
                {meta.subtitle}
              </p>

              <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 24px 0", flex: 1 }}>
                {meta.details}
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
          );
        })}
      </div>
    </div>
  );
}
