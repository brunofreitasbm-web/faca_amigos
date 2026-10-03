import { useEffect, useRef } from "react";
import { money } from "@facaamigos/domain";
import { Card } from "@facaamigos/ui";
import { trackEvent } from "../../lib/analytics.js";
import type { RenovarOpcao } from "./renovarSite.js";

/**
 * Renovação pelo WhatsApp, sem esperar o aviso. O botão abre a conversa com o
 * pedido escrito; a equipe confirma no balcão e o valor é acertado no caixa.
 */
export function RenovarCard({ childFirstName, opcoes }: { childFirstName: string; opcoes: RenovarOpcao[] }) {
  const vistoLogged = useRef(false);

  useEffect(() => {
    if (vistoLogged.current) return;
    vistoLogged.current = true;
    trackEvent("renovar_site_visto");
  }, []);

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "8px", border: "1.5px solid var(--color-orange)" }}>
      <strong style={{ fontSize: "16px", lineHeight: 1.3 }}>Quer mais tempo para {childFirstName}?</strong>
      <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "var(--text-muted)" }}>
        Toque para pedir a renovação pelo WhatsApp. A equipe confirma no balcão e o valor é acertado lá.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "4px" }}>
        {opcoes.map((o) => (
          <a
            key={o.minutes}
            href={o.whatsappUrl}
            target="_blank"
            rel="noopener"
            onClick={() => trackEvent("renovar_site_clique", { minutes: o.minutes })}
            style={{
              flex: "1 1 140px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "44px",
              padding: "0 16px",
              background: "var(--color-orange)",
              color: "var(--color-white)",
              fontFamily: "var(--font-body)",
              fontSize: "14px",
              fontWeight: 800,
              textDecoration: "none",
              borderRadius: "var(--radius-full)",
            }}
          >
            +{o.minutes} min · {money(o.cents)}
          </a>
        ))}
      </div>
    </Card>
  );
}
