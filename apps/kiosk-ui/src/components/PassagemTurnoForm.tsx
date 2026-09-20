import { Card, Checkbox, HelpText } from "@facaamigos/ui";
import { HANDOVER_INVALID_MESSAGE, type HandoverDraft, validateHandover } from "../lib/passagemTurno.js";

export interface PassagemTurnoFormProps {
  value: HandoverDraft;
  onChange: (next: HandoverDraft) => void;
  disabled?: boolean;
  /**
   * Mostra o erro de validação abaixo do campo. A tela só liga isto depois
   * da primeira tentativa de fechar — cobrar antes de o operador ter escrito
   * qualquer coisa é ruído.
   */
  showError?: boolean;
}

/**
 * Formulário da passagem de turno, na seção de fechamento do caixa.
 *
 * Quem fecha é obrigado a registrar algo: ou escreve o que precisa ser
 * repassado, ou declara explicitamente que não houve nada. A regra é
 * aplicada de verdade no banco (fa_close_shift); este formulário só evita
 * que o operador descubra isso depois de confirmar o fechamento.
 */
export function PassagemTurnoForm({ value, onChange, disabled = false, showError = false }: PassagemTurnoFormProps) {
  const validation = validateHandover(value);
  const erro = !validation.ok && showError ? HANDOVER_INVALID_MESSAGE[validation.reason] : null;

  return (
    <Card title="Passagem de Turno" style={{ marginTop: "16px" }}>
      <HelpText>
        Obrigatório. Quem abrir o caixa amanhã vai ler isto antes de começar a operar — vocês não se
        encontram, então este é o único canal. Registre alterações, avisos, pendências e regras novas.
      </HelpText>

      <textarea
        value={value.conteudo}
        onChange={(e) => onChange({ ...value, conteudo: e.target.value })}
        disabled={disabled || value.noChanges}
        rows={5}
        placeholder="Ex.: Escorregador azul interditado, manutenção vem terça. Festa da Helena marcada para 15h. Novo limite de 20 crianças na piscina de bolinhas."
        aria-label="Texto da passagem de turno"
        aria-invalid={erro ? true : undefined}
        style={{
          width: "100%",
          marginTop: "12px",
          padding: "12px",
          fontSize: "16px",
          fontFamily: "inherit",
          lineHeight: 1.5,
          color: "var(--text-primary)",
          background: value.noChanges ? "var(--surface-sunken)" : "var(--surface-card)",
          border: `1px solid ${erro ? "var(--color-error)" : "var(--border-subtle)"}`,
          borderRadius: "var(--radius-input)",
          resize: "vertical",
          boxSizing: "border-box",
          opacity: value.noChanges ? 0.5 : 1,
        }}
      />

      <Checkbox
        label="Sem alteração a registrar neste turno"
        helpText="Marque apenas se realmente não houve nada a repassar. Fica registrado no seu nome."
        checked={value.noChanges}
        // Marcar limpa o texto: declarar "nada houve" e deixar um rascunho
        // para trás produz um registro ambíguo para quem lê amanhã.
        onChange={(checked) => onChange({ noChanges: checked, conteudo: checked ? "" : value.conteudo })}
        disabled={disabled}
        style={{ marginTop: "8px" }}
      />

      {erro && (
        <p role="alert" style={{ margin: "4px 0 0", fontSize: "14px", color: "var(--color-error-text)" }}>
          {erro}
        </p>
      )}
    </Card>
  );
}
