import { useEffect, useState } from "react";
import { Button, Badge } from "@facaamigos/ui";
import { Card } from "../GCard.js";
import { Api } from "../../../api/client.js";
import type { Plan, Unit } from "../../../api/client.js";
import { useToast } from "../../../state/ToastContext.js";
import { useConfirm } from "../../../state/ConfirmContext.js";
import {
  generateIdleHoursPlanSuggestions,
  type IdleHoursPlanSuggestion,
} from "../../../lib/geminiAgent.js";
import { money } from "../../../format.js";
import { Emoji3D } from "../../../components/Emoji3D.js";

interface CombosOciososSectionProps {
  units: Unit[];
  onPlanCreated: () => void;
  onSelectForEdit?: (plan: {
    name: string;
    valueReais: string;
    durationValue: string;
    durationUnit: "MINUTO" | "HORA";
    overageReais: string;
    color: string;
  }) => void;
}

function activityForUnit(unit: Unit): "PLAYGROUND" | "CARRINHO" {
  return unit.kind === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";
}

export function CombosOciososSection({
  units,
  onPlanCreated,
  onSelectForEdit,
}: CombosOciososSectionProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const [selectedUnitId, setSelectedUnitId] = useState<string>(units[0]?.id || "");
  const [suggestions, setSuggestions] = useState<IdleHoursPlanSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const currentUnit = units.find((u) => u.id === selectedUnitId) || units[0];

  async function loadSuggestions() {
    if (!currentUnit) return;
    setLoading(true);
    try {
      const activity = activityForUnit(currentUnit);
      const plans = await Api.plans(currentUnit.id, activity, true);
      const results = await generateIdleHoursPlanSuggestions({
        unitId: currentUnit.id,
        unitName: currentUnit.name,
        activity,
        currentPlans: plans.map((p) => ({
          name: p.name,
          valueCents: p.valueCents,
          durationValue: p.durationValue,
        })),
      });
      setSuggestions(results);
    } catch (err) {
      toast.error("Erro ao gerar sugestões de combos ociosos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedUnitId) {
      loadSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnitId]);

  async function handleCreateDirectly(s: IdleHoursPlanSuggestion) {
    if (!currentUnit) return;
    const ok = await confirm({
      title: `Ativar plano "${s.name}"?`,
      message: `O plano será cadastrado como ativo na unidade ${currentUnit.name} por ${money(s.suggestedValueCents)} (${s.durationValue} min). Deseja confirmar?`,
      confirmLabel: "Sim, ativar plano",
      cancelLabel: "Cancelar",
      variant: "default",
    });
    if (!ok) return;

    setBusyId(s.id);
    try {
      await Api.createPlan({
        unitId: currentUnit.id,
        activity: activityForUnit(currentUnit),
        name: s.name,
        valueCents: s.suggestedValueCents,
        durationValue: s.durationValue,
        durationUnit: s.durationUnit,
        overageCentsPerMinute: s.overageCentsPerMinute,
        color: s.color,
      });
      toast.success(`Plano "${s.name}" ativado com sucesso!`);
      onPlanCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar o plano.");
    } finally {
      setBusyId(null);
    }
  }

  function handleSendToForm(s: IdleHoursPlanSuggestion) {
    if (onSelectForEdit) {
      onSelectForEdit({
        name: s.name,
        valueReais: (s.suggestedValueCents / 100).toFixed(2),
        durationValue: String(s.durationValue),
        durationUnit: s.durationUnit,
        overageReais: (s.overageCentsPerMinute / 100).toFixed(2),
        color: s.color,
      });
      toast.success(`Dados do "${s.name}" carregados no formulário acima.`);
    }
  }

  return (
    <section
      aria-label="Precificação e Combos para Horários Ociosos"
      style={{
        marginTop: "20px",
        background: "linear-gradient(135deg, rgba(254, 243, 199, 0.4) 0%, rgba(238, 242, 255, 0.6) 100%)",
        border: "1.5px solid rgba(245, 158, 11, 0.3)",
        borderRadius: "16px",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Badge
              variant="vip"
              style={{
                background: "linear-gradient(135deg, var(--color-amber) 0%, var(--color-primary) 100%)",
                color: "var(--surface-card)",
                fontWeight: "bold",
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "9999px",
              }}
            >
              ✦ ZOEIA YIELD
            </Badge>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "bold", color: "var(--text-primary)" }}>
              Precificação Dinâmica & Combos p/ Horários Ociosos
            </h3>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
            Combos sugeridos pela IA para alavancar faturamento de Segunda a Quinta e início da tarde (12h às 17h).
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {units.length > 1 && (
            <select
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border-color)",
                fontSize: "13px",
                fontWeight: 500,
                background: "var(--surface-card)",
              }}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={loadSuggestions}
            disabled={loading}
            style={{ fontWeight: "bold", gap: "6px" }}
          >
            <Emoji3D e="✨" /> {loading ? "Analisando..." : "Gerar Novas Sugestões"}
          </Button>
        </div>
      </div>

      {loading && suggestions.length === 0 && (
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "10px 0" }}>
          Analisando histórico de movimento e gerando combos estratégicos de horários ociosos...
        </p>
      )}

      {suggestions.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "12px",
          }}
        >
          {suggestions.map((s) => (
            <Card
              key={s.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                borderLeft: `4px solid ${s.color}`,
                background: "var(--surface-card)",
                boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--color-amber-text)" }}>
                    {s.badge}
                  </span>
                  <h4 style={{ margin: "2px 0 0", fontSize: "15px", fontWeight: "bold", color: "var(--text-primary)" }}>
                    {s.name}
                  </h4>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    {s.targetDays} · {s.targetHours}
                  </span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "16px", fontWeight: "bold", color: "var(--color-success-text)" }}>
                    {money(s.suggestedValueCents)}
                  </div>
                  {s.regularValueCents && (
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", textDecoration: "line-through" }}>
                      De {money(s.regularValueCents)}
                    </div>
                  )}
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                    {s.durationValue} min
                  </span>
                </div>
              </div>

              <div style={{ fontSize: "12px", color: "var(--text-secondary)", background: "rgba(0,0,0,0.02)", padding: "6px 8px", borderRadius: "6px" }}>
                <strong>Vantagem:</strong> {s.economicBenefit}
              </div>

              <p style={{ margin: 0, fontSize: "12px", fontStyle: "italic", color: "var(--color-primary-hover)" }}>
                "{s.salesPitch}"
              </p>

              <div style={{ display: "flex", gap: "6px", marginTop: "auto", paddingTop: "6px" }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleCreateDirectly(s)}
                  disabled={busyId === s.id}
                  style={{ flex: 1, fontWeight: "bold", fontSize: "12px" }}
                >
                  {busyId === s.id ? "Ativando..." : "Ativar Plano"}
                </Button>

                {onSelectForEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSendToForm(s)}
                    style={{ fontSize: "11px" }}
                    title="Carregar no formulário acima para editar antes de salvar"
                  >
                    Ajustar
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
