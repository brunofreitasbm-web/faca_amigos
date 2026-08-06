import { useEffect, useState } from "react";
import { Api, systemStatus } from "../api/client.js";

type Failure = "backend" | "print" | null;

/**
 * Overlay de tela cheia com instrução única, para o operador nunca ver
 * erro técnico cru. Escopo real desta arquitetura (kiosk 100% local,
 * sem Sefaz/nuvem, impressão via window.print()): backend local
 * inacessível e impressão bloqueada pelo navegador — não há sinal de
 * hardware para detectar "acabou o papel" de verdade.
 */
export function SystemStatusOverlay() {
  const [failure, setFailure] = useState<Failure>(null);

  useEffect(() => {
    function onBackendDown() {
      setFailure((prev) => prev ?? "backend");
    }
    function onBackendUp() {
      setFailure((prev) => (prev === "backend" ? null : prev));
    }
    function onPrintBlocked() {
      setFailure((prev) => prev ?? "print");
    }
    function onPrintOk() {
      setFailure((prev) => (prev === "print" ? null : prev));
    }

    systemStatus.addEventListener("backend-unreachable", onBackendDown);
    systemStatus.addEventListener("backend-reachable", onBackendUp);
    systemStatus.addEventListener("print-blocked", onPrintBlocked);
    systemStatus.addEventListener("print-ok", onPrintOk);
    return () => {
      systemStatus.removeEventListener("backend-unreachable", onBackendDown);
      systemStatus.removeEventListener("backend-reachable", onBackendUp);
      systemStatus.removeEventListener("print-blocked", onPrintBlocked);
      systemStatus.removeEventListener("print-ok", onPrintOk);
    };
  }, []);

  // Enquanto o backend estiver marcado como fora do ar, tenta reconectar sozinho.
  useEffect(() => {
    if (failure !== "backend") return;
    const interval = setInterval(() => {
      Api.units()
        .then(() => setFailure(null))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [failure]);

  if (!failure) return null;

  const content =
    failure === "backend"
      ? { icon: "🔌", text: "Sem conexão com o servidor local — o sistema continua tentando reconectar." }
      : { icon: "🖨️", text: "Impressão bloqueada pelo navegador — libere pop-ups para este site e toque em Reimprimir." };

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 20, 20, 0.95)",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        zIndex: 999999,
        textAlign: "center",
        padding: "24px",
      }}
    >
      <div style={{ fontSize: "96px" }}>{content.icon}</div>
      <p style={{ fontSize: "24px", fontWeight: "bold", maxWidth: "560px", margin: 0 }}>{content.text}</p>
      {failure === "print" && (
        <button
          onClick={() => setFailure(null)}
          title="Fechar este aviso"
          style={{
            marginTop: "8px",
            padding: "10px 24px",
            borderRadius: "9999px",
            border: "none",
            background: "#fff",
            color: "#141414",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          Entendi
        </button>
      )}
    </div>
  );
}
