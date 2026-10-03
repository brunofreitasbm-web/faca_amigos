import { useEffect, useRef } from "react";
import { Card } from "@facaamigos/ui";
import { trackEvent } from "../../lib/analytics.js";

/** Olhar FaçaAmigos de hoje, aberto direto da tela de acompanhamento. */
export function OlharCard({ childFirstName, url }: { childFirstName: string; url: string }) {
  const vistoLogged = useRef(false);

  useEffect(() => {
    if (vistoLogged.current) return;
    vistoLogged.current = true;
    trackEvent("olhar_site_visto");
  }, []);

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "8px", border: "1.5px solid var(--color-teal)" }}>
      <strong style={{ fontSize: "16px", lineHeight: 1.3 }}>O Olhar FaçaAmigos de {childFirstName} está pronto 💛</strong>
      <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: "var(--text-muted)" }}>
        Um registro observacional de como {childFirstName} brincou hoje, feito pela nossa equipe. Não é uma avaliação.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener"
        onClick={() => trackEvent("olhar_site_clique")}
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
        Abrir o Olhar
      </a>
    </Card>
  );
}
