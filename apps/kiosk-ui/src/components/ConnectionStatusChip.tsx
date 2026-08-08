import { useConnectionStatus, type ConnectionStatus } from "../hooks/useConnectionStatus.js";

const STYLE: Record<ConnectionStatus, { dot: string; label: string; title: string }> = {
  online: {
    dot: "var(--color-teal, #2ECFB5)",
    label: "Conectado",
    title: "Conectado ao servidor — tudo funcionando em tempo real",
  },
  degraded: {
    dot: "var(--color-yellow, #FFE234)",
    label: "Sem internet",
    title: "Rede local OK, mas a nuvem não responde — operações ficam na fila e são enviadas quando a internet voltar",
  },
  offline: {
    dot: "#E5484D",
    label: "Offline",
    title: "Sem conexão de rede — verifique o Wi-Fi do aparelho",
  },
};

/** Indicador discreto de conexão no cabeçalho (verde/amarelo/vermelho). */
export function ConnectionStatusChip() {
  const { status, pending } = useConnectionStatus();
  const s = STYLE[status];

  return (
    <span
      title={s.title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        fontWeight: 700,
        color: "var(--text-secondary)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "999px",
        padding: "4px 10px",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: s.dot,
          boxShadow: status === "online" ? "0 0 6px var(--color-teal, #2ECFB5)" : undefined,
          flexShrink: 0,
        }}
      />
      {s.label}
      {pending > 0 && <span style={{ opacity: 0.75 }}>· {pending} na fila</span>}
    </span>
  );
}
