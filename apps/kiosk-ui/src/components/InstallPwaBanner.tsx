import { useEffect, useState } from "react";
import { isElectronLocal, isStandalone } from "../pwa.js";

/**
 * Banner que orienta a instalação do app na tela inicial (PWA).
 *
 * - Android/Chrome: captura o `beforeinstallprompt` (listener registrado
 *   no load do módulo — o evento dispara cedo, antes do mount) e oferece
 *   o botão "Instalar aplicativo" nativo.
 * - iOS Safari: não existe prompt programático — mostra o passo a passo
 *   "Compartilhar → Adicionar à Tela de Início".
 * Oculto quando já está instalado (standalone), no Electron, ou se o
 * operador dispensou há menos de 14 dias.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    promptListeners.forEach((fn) => fn());
  });
}

const DISMISS_KEY = "fa_install_banner_dismissed_at";
const DISMISS_DAYS = 14;

function isDismissed(): boolean {
  const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
  return at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

function isIos(): boolean {
  // iPadOS se apresenta como macOS — o toque (maxTouchPoints) desempata.
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1)
  );
}

function isIosSafari(): boolean {
  // Chrome/Firefox/Edge no iOS não instalam PWA de forma confiável — a
  // orientação só vale no Safari (sem tokens CriOS/FxiOS/EdgiOS).
  return isIos() && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
}

export function InstallPwaBanner() {
  const [visible, setVisible] = useState(false);
  const [canPrompt, setCanPrompt] = useState(deferredPrompt !== null);

  useEffect(() => {
    if (isElectronLocal() || isStandalone() || isDismissed()) return;
    const onPrompt = () => {
      setCanPrompt(true);
      setVisible(true);
    };
    promptListeners.add(onPrompt);
    if (deferredPrompt !== null || isIosSafari()) setVisible(true);
    return () => {
      promptListeners.delete(onPrompt);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === "accepted") setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Instalar aplicativo"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: `calc(12px + env(safe-area-inset-bottom, 0px))`,
        zIndex: 900,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 16,
        background: "var(--color-bg-app, #141414)",
        color: "#fff",
        boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
      }}
    >
      <img src="/icons/pwa-192.png" alt="" style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Instale o FaçaAmigos</div>
        {canPrompt ? (
          <div style={{ fontSize: 13, opacity: 0.85 }}>Abra em tela cheia, com ícone na tela inicial.</div>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            Toque em <strong>Compartilhar</strong>{" "}
            <span aria-hidden="true" style={{ display: "inline-block", transform: "translateY(1px)" }}>
              ⎋
            </span>{" "}
            e depois em <strong>Adicionar à Tela de Início</strong>.
          </div>
        )}
      </div>
      {canPrompt && (
        <button
          onClick={() => void install()}
          style={{
            border: "none",
            borderRadius: 12,
            padding: "10px 14px",
            fontWeight: 800,
            fontSize: 14,
            background: "var(--color-pink, #F0196B)",
            color: "#fff",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Instalar
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Dispensar"
        style={{
          border: "none",
          background: "transparent",
          color: "#fff",
          opacity: 0.6,
          fontSize: 18,
          cursor: "pointer",
          flexShrink: 0,
          padding: 4,
        }}
      >
        ✕
      </button>
    </div>
  );
}
