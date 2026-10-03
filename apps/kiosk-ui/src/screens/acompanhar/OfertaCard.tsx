import { useEffect, useRef } from "react";
import { Card } from "@facaamigos/ui";
import { trackEvent } from "../../lib/analytics.js";
import { type Oferta, whatsappUrl } from "./ofertaSite.js";

/**
 * Oferta de produto no fim do plano. Não tem dispensa guardada: só aparece
 * nos últimos 15 minutos, então some sozinha quando a visita acaba.
 */
export function OfertaCard({ oferta }: { oferta: Oferta }) {
  const vistoLogged = useRef<string | null>(null);

  useEffect(() => {
    if (vistoLogged.current === oferta.kind) return;
    vistoLogged.current = oferta.kind;
    trackEvent("oferta_site_vista", { kind: oferta.kind });
  }, [oferta.kind]);

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "8px", border: "1.5px solid var(--color-teal)" }}>
      <strong style={{ fontSize: "16px", lineHeight: 1.3 }}>{oferta.title}</strong>
      <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "var(--text-muted)" }}>{oferta.body}</p>
      <a
        href={whatsappUrl(oferta.whatsappText)}
        target="_blank"
        rel="noopener"
        onClick={() => trackEvent("oferta_site_clique", { kind: oferta.kind })}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "44px",
          marginTop: "4px",
          padding: "0 20px",
          background: "var(--color-teal)",
          color: "var(--color-white)",
          fontFamily: "var(--font-body)",
          fontSize: "14px",
          fontWeight: 800,
          textDecoration: "none",
          borderRadius: "var(--radius-full)",
        }}
      >
        {oferta.buttonLabel} no WhatsApp
      </a>
    </Card>
  );
}
