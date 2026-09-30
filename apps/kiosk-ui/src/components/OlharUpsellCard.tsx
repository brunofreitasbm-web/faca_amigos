import { Button } from "@facaamigos/ui";
import { money } from "../format.js";

interface OlharUpsellCardProps {
  /** Nome do plano que o operador acabou de tocar (ex.: "30 minutos"). */
  currentName: string;
  /** Nome do plano de 1 hora oferecido. */
  targetName: string;
  /** Minutos a mais que o plano de 1 hora dá sobre o atual. */
  extraMinutes: number;
  /** Quanto a família pagaria ficando a hora toda no plano atual (excedente incluído). */
  stayCents: number;
  /** Quanto paga no plano de 1 hora. */
  targetCents: number;
  onSwitch: () => void;
  onDismiss: () => void;
}

/**
 * Lembrete de venda: quem escolhe 30 min ouve a oferta do plano de 1 hora
 * com o Olhar FaçaAmigos (o resumo da brincadeira, por WhatsApp) de cortesia.
 *
 * O Olhar só existe a partir de SESSION_REPORT_MIN_MINUTES (60), então a
 * promessa "é só no plano de 1 hora" é verdadeira — não é isca.
 *
 * O argumento de preço é o que a família enxerga no balcão: criança de 30 min
 * que ganha mais 30 no minuto adicional paga mais do que o plano de 1 hora.
 * Os dois valores chegam prontos (já com o desconto do cupom aplicado), para
 * o script bater com o que será cobrado.
 *
 * Mesmo padrão do UpsellOfferCard: script grande para ler em voz alta e as
 * duas ações com o mesmo peso — recusar tem que ser tão fácil quanto aceitar.
 */
export function OlharUpsellCard({
  currentName,
  targetName,
  extraMinutes,
  stayCents,
  targetCents,
  onSwitch,
  onDismiss,
}: OlharUpsellCardProps) {
  return (
    <section
      aria-label="Oferta de plano de 1 hora com o Olhar FaçaAmigos"
      style={{
        marginTop: "10px",
        border: "2px solid var(--color-orange)",
        background: "rgba(255, 122, 0, 0.06)",
        borderRadius: "18px",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <strong style={{ fontFamily: "var(--font-display)", fontSize: "16px", color: "var(--color-orange-text)" }}>
        📋 Ofereça a 1 hora + Olhar FaçaAmigos
      </strong>

      <blockquote
        style={{
          margin: 0,
          fontSize: "18px",
          lineHeight: 1.6,
          color: "var(--text-primary)",
          borderLeft: "4px solid var(--color-orange)",
          paddingLeft: "14px",
          maxWidth: "60ch",
        }}
      >
        “Posso sugerir 1 hora? No plano de 1 hora a nossa equipe acompanha a brincadeira e manda no seu WhatsApp o
        Olhar FaçaAmigos: o resumo de como ele(a) brincou, interagiu e se virou nas atividades. É cortesia, só no
        plano de 1 hora. E se ele(a) ficar {extraMinutes} minutos além dos {currentName.toLowerCase()}, sai {money(stayCents)};
        na de 1 hora são {money(targetCents)}.”
      </blockquote>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <Figure label={`${currentName} + ${extraMinutes} min extra`} value={money(stayCents)} strike />
        <Figure label={`${targetName} + Olhar FaçaAmigos`} value={money(targetCents)} emphasis />
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={onSwitch}
          style={{ flex: 1, minWidth: "240px", borderRadius: "9999px", background: "var(--color-orange-text)" }}
          title={`Trocar para ${targetName} (${money(targetCents)})`}
        >
          ✓ Trocar para 1 hora
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={onDismiss}
          style={{ flex: 1, minWidth: "240px", borderRadius: "9999px" }}
        >
          ✕ Manter {currentName}
        </Button>
      </div>
    </section>
  );
}

function Figure({ label, value, emphasis, strike }: { label: string; value: string; emphasis?: boolean; strike?: boolean }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: "12px",
        background: emphasis ? "rgba(255, 122, 0, 0.14)" : "var(--surface-card)",
        border: `1px solid ${emphasis ? "var(--color-orange)" : "var(--border-subtle)"}`,
        minWidth: "150px",
      }}
    >
      <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div
        style={{
          fontSize: "17px",
          fontWeight: "bold",
          color: emphasis ? "var(--color-orange-text)" : "var(--text-primary)",
          textDecoration: strike ? "line-through" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}
