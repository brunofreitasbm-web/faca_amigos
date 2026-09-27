import { Card } from "@facaamigos/ui";

interface FidelidadeBannerCardProps {
  childFirstName: string;
  visitCount?: number;
}

export function FidelidadeBannerCard({ childFirstName, visitCount = 8 }: FidelidadeBannerCardProps) {
  const currentVisits = visitCount > 0 ? visitCount : 1;
  const cycleVisits = ((currentVisits - 1) % 10) + 1; // 1 to 10 within current cycle
  const isEighthVisit = cycleVisits === 8;
  const isNinthVisit = cycleVisits === 9;
  const isTenthVisit = cycleVisits === 10;

  return (
    <Card
      style={{
        padding: "20px",
        background: "linear-gradient(135deg, #FFF8F0 0%, #FFF1E6 100%)",
        border: "1.5px solid #FDBA74",
        borderRadius: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        boxShadow: "0 6px 16px rgba(249, 115, 22, 0.08)",
      }}
    >
      {/* Header Badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            background: "linear-gradient(135deg, #EA580C 0%, #D97706 100%)",
            color: "#FFFFFF",
            fontWeight: "bold",
            fontSize: "12px",
            padding: "4px 12px",
            borderRadius: "9999px",
            letterSpacing: "0.5px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          🎁 PROGRAMA DE FIDELIDADE
        </span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: "bold",
            color: "#C2410C",
            background: "#FFEDD5",
            padding: "3px 10px",
            borderRadius: "9999px",
            border: "1px solid #FED7AA",
          }}
        >
          {currentVisits}ª Visita
        </span>
      </div>

      {/* Main Message */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <strong style={{ fontSize: "16px", color: "#9A3412", lineHeight: 1.3 }}>
          {isEighthVisit
            ? `🌟 ${childFirstName} está na 8ª visita!`
            : isNinthVisit
            ? `🔥 Falta apenas 1 visita para o prêmio!`
            : isTenthVisit
            ? `🎉 Parabéns! Esta 10ª visita é por nossa conta!`
            : `💛 Cartão Fidelidade de ${childFirstName}`}
        </strong>

        <p style={{ margin: 0, fontSize: "14px", color: "#C2410C", lineHeight: 1.5, fontWeight: isEighthVisit ? 600 : 400 }}>
          {isEighthVisit ? (
            <>
              Depois da próxima sessão (9ª), a sua <strong>10ª visita será 100% GRATUITA!</strong> 🎁✨
            </>
          ) : isNinthVisit ? (
            <>
              Na próxima visita (10ª), <strong>a entrada é totalmente GRATUITA!</strong> 🎉
            </>
          ) : isTenthVisit ? (
            <>
              Você atingiu a 10ª visita! O benefício gratuito do Programa de Fidelidade está liberado! 🎁
            </>
          ) : (
            <>
              A cada 10 visitas, a 10ª sessão é por nossa conta. Faltam apenas{" "}
              <strong>{10 - cycleVisits} visita(s)</strong> para a próxima sessão gratuita!
            </>
          )}
        </p>
      </div>

      {/* Visual Stamps Progress (1 to 10) */}
      <div style={{ marginTop: "4px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
          <span style={{ fontSize: "11px", fontWeight: "bold", color: "#9A3412", textTransform: "uppercase" }}>
            Progresso de Selos ({cycleVisits}/10)
          </span>
          <span style={{ fontSize: "11px", fontWeight: "bold", color: "#EA580C" }}>
            Meta: 10ª Grátis
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px" }}>
          {Array.from({ length: 10 }).map((_, index) => {
            const stepNum = index + 1;
            const isCompleted = stepNum <= cycleVisits;
            const isTarget = stepNum === 10;
            const isNextFreeAlert = isEighthVisit && stepNum === 10;

            return (
              <div
                key={stepNum}
                style={{
                  height: "38px",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  fontSize: "12px",
                  fontWeight: "bold",
                  transition: "all 0.2s ease",
                  background: isCompleted
                    ? "linear-gradient(135deg, #F97316 0%, #EA580C 100%)"
                    : isTarget
                    ? "#FEF3C7"
                    : "#FFF",
                  color: isCompleted ? "#FFF" : isTarget ? "#B45309" : "#9CA3AF",
                  border: isNextFreeAlert
                    ? "2px dashed #EA580C"
                    : isCompleted
                    ? "1px solid #EA580C"
                    : isTarget
                    ? "1.5px solid #F59E0B"
                    : "1px solid #FED7AA",
                  boxShadow: isCompleted ? "0 2px 6px rgba(234, 88, 12, 0.25)" : "none",
                }}
              >
                {isCompleted ? (
                  <span>✓</span>
                ) : isTarget ? (
                  <span style={{ fontSize: "14px" }}>🎁</span>
                ) : (
                  <span>{stepNum}</span>
                )}
                <span style={{ fontSize: "9px", opacity: 0.8, marginTop: "-2px" }}>
                  {isTarget ? "GRÁTIS" : `${stepNum}ª`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
