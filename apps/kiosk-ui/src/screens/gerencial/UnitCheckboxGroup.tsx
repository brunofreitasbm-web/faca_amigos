import type { Unit } from "../../api/client.js";

/**
 * "Aplicar em:" — cada unidade marcada vira uma linha própria no banco (o
 * Gerencial não compartilha uma linha entre unidades, ver plano). Editar
 * depois é sempre por linha/unidade individual, então este grupo só aparece
 * no formulário de criação, nunca no de edição.
 */
export function UnitCheckboxGroup({
  units,
  selected,
  onChange,
}: {
  units: Unit[];
  selected: string[];
  onChange: (unitIds: string[]) => void;
}) {
  function toggle(unitId: string) {
    onChange(selected.includes(unitId) ? selected.filter((id) => id !== unitId) : [...selected, unitId]);
  }

  return (
    <div>
      <label>Aplicar em</label>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
        {units.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => toggle(u.id)}
            aria-pressed={selected.includes(u.id)}
            style={{
              padding: "8px 14px",
              borderRadius: "9999px",
              border: selected.includes(u.id) ? "2px solid var(--color-primary)" : "1px solid var(--border-subtle)",
              background: selected.includes(u.id) ? "rgba(240, 25, 107, 0.08)" : "var(--surface-card)",
              fontSize: "13px",
              fontWeight: selected.includes(u.id) ? "bold" : "normal",
              cursor: "pointer",
            }}
          >
            {selected.includes(u.id) ? "✓ " : ""}
            {u.name}
          </button>
        ))}
      </div>
    </div>
  );
}
