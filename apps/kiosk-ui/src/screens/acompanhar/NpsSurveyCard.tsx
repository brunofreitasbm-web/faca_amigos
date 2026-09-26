import { useState, useEffect } from "react";
import { Card, Button, HelpText } from "@facaamigos/ui";
import { logAcompanharEvento } from "../../api/acompanhar.js";

interface NpsSurveyCardProps {
  code: string;
  childFirstName?: string;
  activity?: "PLAYGROUND" | "CARRINHO";
  onSubmitted?: () => void;
}

export function NpsSurveyCard({ code, childFirstName, activity, onSubmitted }: NpsSurveyCardProps) {
  const [playgroundScore, setPlaygroundScore] = useState<number | null>(null);
  const [circuitoScore, setCircuitoScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const storageKey = `fa_nps_submitted_${code}`;

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === "true") {
        setSubmitted(true);
      }
    } catch {}
  }, [storageKey]);

  async function handleSubmit() {
    if (playgroundScore === null && circuitoScore === null) return;
    setSubmitting(true);
    try {
      await logAcompanharEvento(code, "AVALIACAO_NPS", {
        playgroundScore,
        circuitoScore,
        feedback: feedback.trim(),
        submittedAtMs: Date.now(),
        activity,
      });
      try {
        localStorage.setItem(storageKey, "true");
      } catch {}
      setSubmitted(true);
      onSubmitted?.();
    } catch (err) {
      console.error("Erro ao enviar NPS:", err);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card
        style={{
          width: "100%",
          maxWidth: 420,
          background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
          border: "1.5px solid #4ade80",
          borderRadius: "16px",
          textAlign: "center",
          padding: "24px 20px",
          boxShadow: "0 4px 14px rgba(22, 163, 74, 0.08)",
        }}
      >
        <div style={{ fontSize: "36px", marginBottom: "8px" }}>🎁 💛</div>
        <h3 style={{ margin: "0 0 8px", fontSize: "18px", color: "#15803d", fontFamily: "var(--font-display)" }}>
          Obrigado pela sua avaliação!
        </h3>
        <p style={{ margin: "0 0 14px", fontSize: "14px", color: "#166534", lineHeight: 1.5 }}>
          Sua opinião ajuda a melhorar cada momento da brincadeira{childFirstName ? ` do(a) ${childFirstName}` : ""}.
        </p>
        <div
          style={{
            background: "#ffffff",
            borderRadius: "12px",
            padding: "12px 14px",
            border: "1px dashed #86efac",
            fontSize: "13px",
            color: "#14532d",
            lineHeight: 1.4,
          }}
        >
          <strong>Dica Especial:</strong> Mostre esta tela no balcão e confira nossas ofertas e combos promocionais para a próxima visita! 🚀
        </div>
      </Card>
    );
  }

  const renderRatingGroup = (
    title: string,
    subtitle: string,
    badgeText: string,
    isPrimary: boolean,
    currentValue: number | null,
    onSelect: (val: number) => void
  ) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--text-main, #1e293b)" }}>
          {title}
        </span>
        {isPrimary && (
          <span
            style={{
              background: "#e0f2fe",
              color: "#0369a1",
              fontSize: "10px",
              fontWeight: "bold",
              padding: "2px 8px",
              borderRadius: "9999px",
            }}
          >
            {badgeText}
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted, #64748b)" }}>{subtitle}</p>

      {/* Grid 0 to 10 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(11, 1fr)",
          gap: "4px",
          marginTop: "4px",
        }}
      >
        {Array.from({ length: 11 }, (_, i) => {
          const isSelected = currentValue === i;
          let bgColor = "#f1f5f9";
          let textColor = "#334155";
          let borderColor = "#cbd5e1";

          if (isSelected) {
            if (i <= 6) {
              bgColor = "#ef4444";
              textColor = "#ffffff";
              borderColor = "#dc2626";
            } else if (i <= 8) {
              bgColor = "#f59e0b";
              textColor = "#ffffff";
              borderColor = "#d97706";
            } else {
              bgColor = "#0d9488";
              textColor = "#ffffff";
              borderColor = "#0f766e";
            }
          }

          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              style={{
                height: "36px",
                border: `1.5px solid ${borderColor}`,
                borderRadius: "8px",
                background: bgColor,
                color: textColor,
                fontSize: "13px",
                fontWeight: isSelected ? "bold" : "600",
                cursor: "pointer",
                transition: "all 0.15s ease",
                transform: isSelected ? "scale(1.08)" : "scale(1)",
                boxShadow: isSelected ? "0 2px 6px rgba(0,0,0,0.15)" : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
              title={`${i}`}
            >
              {i}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#94a3b8", padding: "0 2px" }}>
        <span>0 = Pouco provável</span>
        <span>10 = Muito provável</span>
      </div>
    </div>
  );

  const canSubmit = playgroundScore !== null || circuitoScore !== null;

  return (
    <Card
      style={{
        width: "100%",
        maxWidth: 420,
        background: "#ffffff",
        border: "1.5px solid #cbd5e1",
        borderRadius: "16px",
        padding: "20px 18px",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.05)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "16px" }}>
        <span
          style={{
            background: "linear-gradient(135deg, #0d9488 0%, #2563eb 100%)",
            color: "#ffffff",
            fontWeight: "bold",
            fontSize: "11px",
            padding: "4px 12px",
            borderRadius: "9999px",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          ⭐ Avaliação de Experiência (NPS)
        </span>
        <h3
          style={{
            margin: "10px 0 4px",
            fontSize: "17px",
            color: "var(--text-main, #0f172a)",
            fontFamily: "var(--font-display)",
          }}
        >
          Como foi a experiência hoje?
        </h3>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted, #64748b)" }}>
          Em uma escala de 0 a 10, o quanto você recomendaria nossas atrações para amigos?
        </p>
      </div>

      {renderRatingGroup(
        "🏰 Playground (Espaço de Brincar)",
        "Avalie os brinquedos, monitores e estrutura do Playground",
        activity === "PLAYGROUND" ? "Visita Atual" : "Atração",
        activity === "PLAYGROUND",
        playgroundScore,
        setPlaygroundScore
      )}

      {renderRatingGroup(
        "🏎️ Circuito (Carrinhos e Pelúcias)",
        "Avalie a diversão e segurança dos veículos do Circuito",
        activity === "CARRINHO" ? "Visita Atual" : "Atração",
        activity === "CARRINHO",
        circuitoScore,
        setCircuitoScore
      )}

      <div style={{ marginBottom: "16px" }}>
        <label
          htmlFor="nps-feedback"
          style={{
            display: "block",
            fontSize: "13px",
            fontWeight: "600",
            color: "#334155",
            marginBottom: "6px",
          }}
        >
          O que mais gostou ou o que podemos melhorar? (Opcional)
        </label>
        <textarea
          id="nps-feedback"
          rows={3}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Escreva aqui suas sugestões ou elogios..."
          style={{
            width: "100%",
            borderRadius: "10px",
            border: "1px solid #cbd5e1",
            padding: "10px 12px",
            fontSize: "13px",
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box",
            outline: "none",
          }}
        />
      </div>

      <Button
        variant="primary"
        fullWidth
        disabled={!canSubmit || submitting}
        onClick={handleSubmit}
        style={{
          background: canSubmit ? "linear-gradient(135deg, #0d9488 0%, #059669 100%)" : undefined,
          color: "#ffffff",
          fontWeight: "bold",
          fontSize: "15px",
        }}
      >
        {submitting ? "Enviando..." : "Enviar Avaliação"}
      </Button>

      {!canSubmit && (
        <HelpText style={{ textAlign: "center", marginTop: "8px" }}>
          Selecione uma nota de 0 a 10 para enviar sua avaliação.
        </HelpText>
      )}
    </Card>
  );
}
