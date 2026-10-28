import { useEffect, useState } from "react";
import { Card } from "@facaamigos/ui";
import { registrarAcompanharPushOlhar } from "../../api/acompanhar.js";
import { trackEvent } from "../../lib/analytics.js";
import { isPushSupported, pushSubscriptionToKeys, subscribeToPush } from "../../lib/push.js";

type Estado = "oculto" | "pronto" | "enviando" | "ativo" | "erro";

const storageKey = (code: string) => `fa_olhar_push_${code}`;

function jaAtivado(code: string): boolean {
  try {
    return localStorage.getItem(storageKey(code)) === "1";
  } catch {
    return false;
  }
}

function lembrarAtivacao(code: string): void {
  try {
    localStorage.setItem(storageKey(code), "1");
  } catch {
    // Storage bloqueado: o botão volta na próxima abertura, sem prejuízo.
  }
}

/**
 * Convite para ser avisado quando o Olhar FaçaAmigos ficar pronto, mesmo com o painel fechado.
 * O Olhar sai de alguns minutos a ~40 min depois do checkout; quem já saiu do painel só descobre
 * por aqui (ou pelo WhatsApp, que a Meta nem sempre entrega). Não aparece onde o navegador não
 * suporta push (ex.: iPhone fora do app instalado) ou quando as notificações estão bloqueadas.
 */
export function AvisoOlharPush({ code, childFirstName }: { code: string; childFirstName: string }) {
  const [estado, setEstado] = useState<Estado>("oculto");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (jaAtivado(code)) {
      setEstado("ativo");
      return;
    }
    const bloqueado = "Notification" in window && Notification.permission === "denied";
    setEstado(isPushSupported() && !bloqueado ? "pronto" : "oculto");
  }, [code]);

  async function ativar() {
    setErro(null);
    setEstado("enviando");
    try {
      const sub = await subscribeToPush();
      const keys = sub ? pushSubscriptionToKeys(sub) : null;
      if (!keys) throw new Error("Este navegador não permite receber o aviso.");
      await registrarAcompanharPushOlhar(code, keys);
      lembrarAtivacao(code);
      setEstado("ativo");
      trackEvent("olhar_push_ativado");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível ativar o aviso agora.");
      setEstado("erro");
    }
  }

  if (estado === "oculto") return null;

  if (estado === "ativo") {
    return (
      <Card style={{ border: "1.5px solid var(--color-teal)" }}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5 }}>
          ✅ Aviso ativado. Vamos te avisar quando o Olhar de {childFirstName} estiver pronto.
        </p>
      </Card>
    );
  }

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "8px", border: "1.5px solid var(--color-teal)" }}>
      <strong style={{ fontSize: "16px", lineHeight: 1.3 }}>Quer ser avisado quando o Olhar de {childFirstName} chegar?</strong>
      <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "var(--text-muted)" }}>
        Ele sai pouco depois da visita. Ative o aviso e a notificação chega no celular, mesmo com esta tela fechada.
      </p>
      {erro && (
        <p role="alert" style={{ margin: 0, fontSize: "13px", color: "var(--color-orange)" }}>
          {erro}
        </p>
      )}
      <button
        type="button"
        onClick={ativar}
        disabled={estado === "enviando"}
        style={{
          minHeight: "44px",
          marginTop: "4px",
          padding: "0 20px",
          background: "var(--color-teal)",
          color: "var(--color-white)",
          border: "none",
          fontFamily: "var(--font-body)",
          fontSize: "14px",
          fontWeight: 800,
          borderRadius: "var(--radius-full)",
          cursor: estado === "enviando" ? "wait" : "pointer",
          opacity: estado === "enviando" ? 0.7 : 1,
        }}
      >
        {estado === "enviando" ? "Ativando…" : "Avisar quando chegar"}
      </button>
    </Card>
  );
}
