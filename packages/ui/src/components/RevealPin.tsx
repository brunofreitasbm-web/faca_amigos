import { useEffect, useRef, useState } from "react";

const AUTO_HIDE_MS = 6_000;

/**
 * PIN escondido por padrão, revelado por toque explícito.
 *
 * Usado para o PIN de saída no card do Painel — o único segredo que fica
 * SÓ com o responsável, no recibo de guarda, e confere quem está
 * autorizado a levar a criança embora. Mostrar em texto aberto o tempo
 * todo anularia essa proteção: qualquer pessoa que veja a tela por cima
 * do ombro (ou uma foto dela) passaria a "saber" o PIN de qualquer
 * criança sem ter o recibo. Um toque revela por alguns segundos — rápido
 * pra quem precisa, ilegível de relance pra quem só está olhando.
 */
export function RevealPin({ pin, label = "PIN" }: { pin: string; label?: string }) {
  const [revealed, setRevealed] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  function reveal(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    setRevealed(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRevealed(false), AUTO_HIDE_MS);
  }

  return (
    <button
      type="button"
      onClick={reveal}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") reveal(e);
      }}
      title={revealed ? undefined : `Toque para ver o ${label} de saída`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        border: "none",
        background: "none",
        padding: 0,
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: revealed ? "0.08em" : "0.2em",
      }}
    >
      {label}: <strong>{revealed ? pin : "····"}</strong>
      {!revealed && <span aria-hidden="true" style={{ fontSize: "0.85em" }}>👁</span>}
    </button>
  );
}
