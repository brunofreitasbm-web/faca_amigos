import { useEffect, useState } from "react";
import { voiceRecorder, type VoiceRecorderPublicState } from "../lib/voiceRecorder.js";

/**
 * Pill discreto "gravando" — o único aviso de consentimento decidido para
 * esta gravação (ver plano de voz). Fica montado uma vez em App.tsx, fora
 * de qualquer tela, porque o singleton voiceRecorder sobrevive à troca de
 * tela e o indicador precisa acompanhar.
 */
export function RecordingIndicator() {
  const [state, setState] = useState<VoiceRecorderPublicState>({ status: "idle" });

  useEffect(() => voiceRecorder.subscribe(setState), []);

  const [elapsedLabel, setElapsedLabel] = useState("00:00");
  useEffect(() => {
    if (state.status !== "recording" || !state.startedAtMs) return;
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - state.startedAtMs!) / 1000));
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      setElapsedLabel(`${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state.status, state.startedAtMs]);

  if (state.status !== "recording") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "12px",
        right: "12px",
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 12px",
        borderRadius: "9999px",
        background: "rgba(20, 20, 20, 0.85)",
        color: "#fff",
        fontSize: "12px",
        fontWeight: 700,
        letterSpacing: "0.02em",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      }}
    >
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: "#ff4d4f",
          animation: "fa-rec-pulse 1.4s ease-in-out infinite",
        }}
      />
      <span>gravando</span>
      <span style={{ opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>{elapsedLabel}</span>
      <style>{`
        @keyframes fa-rec-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}
