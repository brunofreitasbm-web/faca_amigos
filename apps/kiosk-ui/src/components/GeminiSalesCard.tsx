import { useState } from "react";
import { Button, Badge } from "@facaamigos/ui";
import type { CheckinOffer, CheckoutOffer } from "../lib/geminiAgent.js";
import { money } from "../format.js";

interface GeminiCheckinSalesCardProps {
  type: "CHECKIN";
  offers: CheckinOffer[];
  loading?: boolean;
  onApplyOffer: (offer: CheckinOffer) => void;
  onDismiss?: () => void;
}

interface GeminiCheckoutSalesCardProps {
  type: "CHECKOUT";
  offers: CheckoutOffer[];
  loading?: boolean;
  onApplyOffer: (offer: CheckoutOffer) => void;
  onDismiss?: () => void;
}

type GeminiSalesCardProps = GeminiCheckinSalesCardProps | GeminiCheckoutSalesCardProps;

export function GeminiSalesCard(props: GeminiSalesCardProps) {
  const { type, offers, loading, onDismiss } = props;
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || (!loading && offers.length === 0)) {
    return null;
  }

  return (
    <section
      aria-label="Sugestões do Agente IA Gemini"
      style={{
        background: "linear-gradient(135deg, rgba(147, 51, 234, 0.07) 0%, rgba(59, 130, 246, 0.07) 100%)",
        border: "2px solid rgba(147, 51, 234, 0.3)",
        borderRadius: "18px",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        boxShadow: "0 4px 12px rgba(147, 51, 234, 0.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Badge
            variant="vip"
            style={{
              background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
              color: "#ffffff",
              fontWeight: "bold",
              fontSize: "12px",
              padding: "4px 10px",
              borderRadius: "9999px",
            }}
          >
            ✦ ZOEIA
          </Badge>
          <strong style={{ fontSize: "15px", color: "var(--text-primary)" }}>
            {type === "CHECKIN" ? "Indicação da ZoeIA para o Balcão" : "Sugestão da ZoeIA para Fidelizar no Check-out"}
          </strong>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              onDismiss();
            }}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: "14px",
              padding: "2px 6px",
            }}
            title="Ocultar sugestões"
          >
            ✕
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>
          Analisando perfil com a Gemini API...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {offers.map((offer) => (
            <div
              key={offer.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "14px",
                padding: "12px 14px",
                background: "var(--surface-card, #ffffff)",
                borderRadius: "14px",
                border: "1px solid rgba(147, 51, 234, 0.15)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: "220px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                  <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>{offer.title}</strong>
                  {offer.badge && (
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "600",
                        padding: "2px 8px",
                        borderRadius: "12px",
                        background: "rgba(147, 51, 234, 0.1)",
                        color: "#7c3aed",
                      }}
                    >
                      {offer.badge}
                    </span>
                  )}
                  {"priceCents" in offer && offer.priceCents && (
                    <span style={{ fontSize: "13px", fontWeight: "bold", color: "#16a34a" }}>
                      + {money(offer.priceCents)}
                    </span>
                  )}
                </div>

                <p style={{ margin: "0 0 4px 0", fontSize: "13px", color: "var(--text-primary)", fontWeight: "500", lineHeight: 1.4 }}>
                  🗣️ <strong>Fale para o responsável:</strong> "{offer.description}"
                </p>

                {offer.reason && (
                  <span style={{ fontSize: "11px", color: "#6b7280", fontStyle: "italic", display: "block", marginTop: "2px" }}>
                    💡 <strong>Vantagem ZoeIA:</strong> {offer.reason}
                  </span>
                )}
              </div>

              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  if (props.type === "CHECKIN") {
                    props.onApplyOffer(offer as CheckinOffer);
                  } else {
                    props.onApplyOffer(offer as CheckoutOffer);
                  }
                }}
                style={{
                  background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
                  border: "none",
                  borderRadius: "9999px",
                  fontWeight: "bold",
                  padding: "8px 16px",
                  whiteSpace: "nowrap",
                }}
              >
                ✦ Aplicar em 1 Clique
              </Button>
            </div>
          ))}

          {/* Mensagem subliminar motivacional para o Operador Bater Meta */}
          <div
            style={{
              background: "linear-gradient(135deg, #fef3c7 0%, #fef08a 100%)",
              border: "1px solid #fde047",
              borderRadius: "10px",
              padding: "8px 12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "4px",
            }}
          >
            <span style={{ fontSize: "14px" }}>🎯</span>
            <span style={{ fontSize: "12px", color: "#854d0e", fontWeight: "600" }}>
              <strong>Incentivo do Turno:</strong> Cada oferta aplicada agora eleva seu ticket médio e coloca a equipe mais perto da bonificação diária da unidade!
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
