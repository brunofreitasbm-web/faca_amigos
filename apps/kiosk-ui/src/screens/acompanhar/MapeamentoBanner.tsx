import { useEffect, useRef, useState } from "react";
import type { SessionTiming } from "@facaamigos/domain";
import { trackEvent } from "../../lib/analytics.js";

/** 30 dias em ms — validade da dispensa guardada no localStorage. */
const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const DISMISS_KEY = "fa_banner_mapeamento_dismissed_until";

/** Atraso antes de aparecer: o tempo restante precisa já estar na tela. */
const APPEAR_DELAY_MS = 1500;

const MAPEAMENTO_URL =
  "https://institutofacaamigos.com.br/teste?utm_source=playground-app&utm_medium=qrcode&utm_campaign=mapeamento&utm_content=banner-tempo";

/** Paleta do Instituto FaçaAmigos (distinta da paleta do playground). */
const PETROLEO = "#065264";
const TURQUESA = "#07C5C8";
const AMARELO = "#FDC51D";

function isDismissed(): boolean {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DURATION_MS));
  } catch {
    // Modo privado / storage bloqueado: o banner volta na próxima visita.
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Decide se o convite ao Mapeamento pode aparecer nesta sessão.
 *
 * Regra de produto: o cronômetro é o conteúdo principal da tela. Quando
 * falta pouco para acabar (< 5 min), o responsável está se organizando
 * para buscar a criança — qualquer sugestão vira ruído nesse momento.
 */
export function shouldOfferMapeamento(timing: SessionTiming, isPausada: boolean): boolean {
  if (isPausada || timing.isPaused) {
    return false;
  }
  const remainingMs = timing.durationMs - timing.elapsedMs;
  return remainingMs >= 5 * 60_000;
}

export function MapeamentoBanner({ timing, isPausada }: { timing: SessionTiming; isPausada: boolean }) {
  const [dismissed, setDismissed] = useState(() => isDismissed());
  const [visible, setVisible] = useState(false);
  const [faded, setFaded] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const vistoLogged = useRef(false);

  const elegivel = shouldOfferMapeamento(timing, isPausada);

  // Só entra depois que o tempo restante já está renderizado — o banner
  // nunca disputa o primeiro olhar com o cronômetro.
  useEffect(() => {
    if (dismissed || !elegivel) return;
    const t = window.setTimeout(() => setVisible(true), APPEAR_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [dismissed, elegivel]);

  // Fade-in num segundo frame (com reduced-motion, já nasce opaco).
  useEffect(() => {
    if (!visible) return;
    if (prefersReducedMotion()) {
      setFaded(true);
      return;
    }
    const raf = window.requestAnimationFrame(() => setFaded(true));
    return () => window.cancelAnimationFrame(raf);
  }, [visible]);

  // Impressão só conta quando o card realmente entra no viewport.
  useEffect(() => {
    const node = cardRef.current;
    if (!visible || !node || vistoLogged.current) return;
    if (typeof IntersectionObserver === "undefined") {
      vistoLogged.current = true;
      trackEvent("banner_mapeamento_visto");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !vistoLogged.current) {
            vistoLogged.current = true;
            trackEvent("banner_mapeamento_visto");
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  if (dismissed || !elegivel || !visible) return null;

  return (
    <section
      ref={cardRef}
      aria-labelledby="mapeamento-titulo"
      style={{
        position: "relative",
        background: PETROLEO,
        color: "var(--color-white)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
        padding: "16px 48px 16px 18px",
        opacity: faded ? 1 : 0,
        transform: faded ? "translateY(0)" : "translateY(6px)",
        transition: "opacity var(--transition-slow), transform var(--transition-slow)",
      }}
    >
      <span
        style={{
          display: "inline-block",
          fontFamily: "var(--font-body)",
          fontSize: "11px",
          fontWeight: 800,
          letterSpacing: "0.6px",
          textTransform: "uppercase",
          color: PETROLEO,
          background: AMARELO,
          borderRadius: "var(--radius-full)",
          padding: "3px 10px",
        }}
      >
        Gratuito · 5 min
      </span>

      <h2
        id="mapeamento-titulo"
        style={{
          margin: "10px 0 4px",
          fontFamily: "var(--font-display)",
          fontSize: "17px",
          fontWeight: 400,
          lineHeight: 1.25,
          color: "var(--color-white)",
        }}
      >
        Conhece o comportamento do seu filho?
      </h2>

      <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.5, color: "rgba(255,255,255,0.88)" }}>
        Responda 5 minutos de perguntas e receba um direcionamento personalizado, gratuito, feito por psicólogas.
      </p>

      <a
        href={MAPEAMENTO_URL}
        target="_blank"
        rel="noopener"
        onClick={() => trackEvent("banner_mapeamento_clique")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "44px",
          marginTop: "12px",
          padding: "0 20px",
          background: TURQUESA,
          color: PETROLEO,
          fontFamily: "var(--font-body)",
          fontSize: "14px",
          fontWeight: 800,
          textDecoration: "none",
          borderRadius: "var(--radius-full)",
        }}
      >
        Fazer o mapeamento gratuito
      </a>

      <button
        type="button"
        aria-label="Dispensar sugestão"
        onClick={() => {
          rememberDismissal();
          setDismissed(true);
        }}
        style={{
          position: "absolute",
          top: "6px",
          right: "6px",
          width: "44px",
          height: "44px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          borderRadius: "var(--radius-full)",
          color: "rgba(255,255,255,0.72)",
          fontSize: "18px",
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        ✕
      </button>
    </section>
  );
}
