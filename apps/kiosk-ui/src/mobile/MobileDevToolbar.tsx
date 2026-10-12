export type SimScreen = "GERENCIAL" | "PRINCIPAL" | "TURNO" | "AUTO";

export function MobileDevToolbar({
  activeScreen,
  onChange,
}: {
  activeScreen: SimScreen;
  onChange: (screen: SimScreen) => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "rgba(18, 24, 38, 0.94)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        padding: "6px 12px",
        borderRadius: "9999px",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.45)",
        maxWidth: "96vw",
        overflowX: "auto",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "#2ECFB5",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          paddingRight: 4,
          whiteSpace: "nowrap",
        }}
      >
        📱 Simulador
      </span>

      <button
        type="button"
        onClick={() => onChange("GERENCIAL")}
        style={{
          border: "none",
          borderRadius: "9999px",
          padding: "6px 12px",
          font: "inherit",
          fontSize: 12,
          fontWeight: 800,
          background: activeScreen === "GERENCIAL" ? "#1D8273" : "rgba(255, 255, 255, 0.12)",
          color: "#fff",
          cursor: "pointer",
          whiteSpace: "nowrap",
          boxShadow: activeScreen === "GERENCIAL" ? "0 4px 14px rgba(29, 130, 115, 0.4)" : "none",
          transition: "all 0.15s ease",
        }}
      >
        📊 Gerencial (Metas + NPS)
      </button>

      <button
        type="button"
        onClick={() => onChange("PRINCIPAL")}
        style={{
          border: "none",
          borderRadius: "9999px",
          padding: "6px 12px",
          font: "inherit",
          fontSize: 12,
          fontWeight: 800,
          background: activeScreen === "PRINCIPAL" ? "#6366F1" : "rgba(255, 255, 255, 0.12)",
          color: "#fff",
          cursor: "pointer",
          whiteSpace: "nowrap",
          boxShadow: activeScreen === "PRINCIPAL" ? "0 4px 14px rgba(99, 102, 241, 0.4)" : "none",
          transition: "all 0.15s ease",
        }}
      >
        🏠 Módulos (Compacta)
      </button>

      <button
        type="button"
        onClick={() => onChange("TURNO")}
        style={{
          border: "none",
          borderRadius: "9999px",
          padding: "6px 12px",
          font: "inherit",
          fontSize: 12,
          fontWeight: 800,
          background: activeScreen === "TURNO" ? "#F0196B" : "rgba(255, 255, 255, 0.12)",
          color: "#fff",
          cursor: "pointer",
          whiteSpace: "nowrap",
          boxShadow: activeScreen === "TURNO" ? "0 4px 14px rgba(240, 25, 107, 0.4)" : "none",
          transition: "all 0.15s ease",
        }}
      >
        📱 Turno de Bruno
      </button>

      {activeScreen !== "AUTO" && (
        <button
          type="button"
          onClick={() => onChange("AUTO")}
          title="Voltar ao fluxo de autenticação normal"
          style={{
            border: "none",
            borderRadius: "9999px",
            padding: "6px 10px",
            font: "inherit",
            fontSize: 11,
            fontWeight: 700,
            background: "transparent",
            color: "rgba(255, 255, 255, 0.65)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ✕ Fechar
        </button>
      )}
    </div>
  );
}
