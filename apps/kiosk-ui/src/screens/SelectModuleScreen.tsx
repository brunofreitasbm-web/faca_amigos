import { Card, Button, Badge } from "@facaamigos/ui";
import { useAppState } from "../state/AppState.js";

interface ModuleConfig {
  idKey: string;
  icon: string;
  title: string;
  subtitle: string;
  location: string;
  details: string;
  color: string;
}

const DEFAULT_MODULES: ModuleConfig[] = [
  {
    idKey: "playground",
    icon: "🏰",
    title: "Playground (Parque Shopping)",
    subtitle: "Operação Loja — Brinquedoteca Física & Regulação Sensorial",
    location: "Parque Shopping Belém",
    details: "Ambiente regulado com neuroarquitetura, mediação ABA, Cantinho da Calma e brinquedos adaptados.",
    color: "var(--color-primary)",
  },
  {
    idKey: "circuito",
    icon: "🏎️",
    title: "Circuito (Parque Shopping)",
    subtitle: "Operação Quiosque — Pista & Carrinhos Elétricos",
    location: "Parque Shopping Belém",
    details: "Pista de carrinhos elétricos no corredor principal, controle de frota e cotação por minutos.",
    color: "var(--color-secondary)",
  },
  {
    idKey: "grão-pará",
    icon: "🌳",
    title: "Playground (Bosque Grão-Pará)",
    subtitle: "Operação Loja — Brinquedoteca Física & Regulação Sensorial",
    location: "Shopping Bosque Grão-Pará",
    details: "Unidade ampliada com espaço de socialização inclusiva para o público da região metropolitana.",
    color: "var(--color-amber)",
  },
];

export function SelectModuleScreen() {
  const { units, setUnitId } = useAppState();

  const displayModules = DEFAULT_MODULES.map((mod) => {
    const matchedUnit = units.find((u) => {
      const lower = u.name.toLowerCase();
      if (mod.idKey === "circuito") return lower.includes("circuito");
      if (mod.idKey === "grão-pará") return lower.includes("grão") || lower.includes("grao");
      return lower.includes("playground");
    });
    return {
      ...mod,
      unitId: matchedUnit?.id || mod.idKey,
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
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "36px", color: "var(--color-primary)", margin: "0 0 8px 0" }}>
          FaçaAmigos
        </h1>
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
          gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
          gap: "24px",
          width: "100%",
          maxWidth: "1080px",
        }}
      >
        {displayModules.map((meta) => {
          return (
            <Card
              key={meta.idKey}
              onClick={() => setUnitId(meta.unitId)}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "24px",
                borderRadius: "24px",
                border: "2px solid var(--border-subtle)",
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
                <Badge variant={meta.idKey === "circuito" ? "teal" : meta.idKey === "grão-pará" ? "amber" : "pink"}>
                  {meta.location}
                </Badge>
              </div>

              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: "0 0 6px 0", color: "var(--text-primary)" }}>
                {meta.title}
              </h2>

              <p style={{ fontSize: "14px", fontWeight: "bold", color: meta.color, margin: "0 0 12px 0" }}>
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
