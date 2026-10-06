import { useEffect, useMemo, useState } from "react";
import { Button, HelpText, Select, Tag } from "@facaamigos/ui";
import { computePaperRollForecast } from "@facaamigos/domain";
import { Api } from "../../../api/client.js";
import type { PaperRoll, Unit } from "../../../api/client.js";
import { useToast } from "../../../state/ToastContext.js";

const MM_PER_M = 1000;

function formatM(mm: number): string {
  return (mm / MM_PER_M).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR");
}

/**
 * Gerencial > Bobinas — consumo de papel térmico por unidade.
 *
 * Cada cupom impresso (check-in, check-out, venda...) já sai do gerador
 * ESC/POS com um comprimento estimado (`escpos.ts`, linhas × 4,23mm) e o
 * print bridge abate isso da bobina ATIVA da unidade (ver migration
 * fa_kiosk_paper_rolls). Esta tela só mostra o que já foi medido e projeta
 * quando a bobina de 30m (ou o tamanho configurado) vai acabar, pra dar
 * tempo de comprar a próxima — sem nenhum sensor de papel, é tudo conta
 * feita a partir do que o app já manda pra impressora.
 */
export function BobinasTab() {
  const toast = useToast();
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<string>("");
  const [roll, setRoll] = useState<PaperRoll | null>(null);
  const [samples, setSamples] = useState<Array<{ printedAtMs: number; lengthMm: number }>>([]);
  const [history, setHistory] = useState<PaperRoll[]>([]);
  const [loading, setLoading] = useState(false);
  const [changing, setChanging] = useState(false);
  const [newRollMeters, setNewRollMeters] = useState("30");

  useEffect(() => {
    Api.units().then((rows) => {
      setUnits(rows);
      const first = rows[0];
      if (first) setUnitId((prev) => prev || first.id);
    });
  }, []);

  useEffect(() => {
    if (!unitId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const activeRoll = await Api.activePaperRoll(unitId);
        if (cancelled) return;
        setRoll(activeRoll);
        if (activeRoll) {
          const since = await Api.paperConsumptionSince(unitId, activeRoll.installedAtMs);
          if (!cancelled) setSamples(since);
        } else {
          setSamples([]);
        }
        const past = await Api.paperRollHistory(unitId);
        if (!cancelled) setHistory(past);
      } catch (err) {
        console.error("Falha ao carregar bobinas:", err);
        if (!cancelled) toast.error("Não foi possível carregar o consumo de bobina desta unidade.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unitId]);

  const forecast = useMemo(() => {
    if (!roll) return null;
    return computePaperRollForecast({
      rollLengthMm: roll.rollLengthMm,
      consumedMm: roll.consumedMm,
      installedAtMs: roll.installedAtMs,
      samples,
      nowMs: Date.now(),
    });
  }, [roll, samples]);

  async function changeRoll() {
    if (!unitId) return;
    const meters = Number(newRollMeters.replace(",", "."));
    if (!Number.isFinite(meters) || meters <= 0) {
      toast.error("Informe o tamanho da bobina em metros (ex.: 30).");
      return;
    }
    setChanging(true);
    try {
      await Api.registerRollChange(unitId, Math.round(meters * MM_PER_M));
      toast.success("Bobina trocada — contagem reiniciada para esta unidade.");
      const [activeRoll, past] = await Promise.all([Api.activePaperRoll(unitId), Api.paperRollHistory(unitId)]);
      setRoll(activeRoll);
      setHistory(past);
      setSamples([]);
    } catch (err) {
      console.error("Falha ao registrar troca de bobina:", err);
      toast.error("Não foi possível registrar a troca de bobina.");
    } finally {
      setChanging(false);
    }
  }

  const percentUsed = roll ? Math.min(100, Math.max(0, (roll.consumedMm / roll.rollLengthMm) * 100)) : 0;
  const overdue = roll ? roll.consumedMm >= roll.rollLengthMm : false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <HelpText>
        Cada cupom de check-in e check-out já é medido no momento em que sai da impressora (linhas de texto + QR,
        mesmo cálculo do diagnóstico de compactação de cupons). Essa medida é abatida aqui da bobina ativa da
        unidade, pra você saber quando vai precisar comprar a próxima — sem precisar contar no olho.
      </HelpText>

      <Select label="Unidade" value={unitId} onChange={(e) => setUnitId(e.target.value)} style={{ minWidth: "220px" }}>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>

      {loading && <p style={{ color: "var(--text-muted)" }}>Carregando...</p>}

      {!loading && !roll && (
        <div
          style={{
            border: "1px dashed var(--border-subtle)",
            borderRadius: "14px",
            padding: "20px",
            color: "var(--text-muted)",
          }}
        >
          Nenhum cupom foi impresso ainda nesta unidade — a bobina ativa é criada automaticamente (30m) na primeira
          impressão. Se já tem uma bobina diferente de 30m instalada agora, registre a troca abaixo com o tamanho
          certo antes da primeira impressão.
        </div>
      )}

      {!loading && roll && forecast && (
        <div
          style={{
            border: `1px solid ${overdue ? "var(--color-coral, #C4453A)" : "var(--border-subtle)"}`,
            borderRadius: "14px",
            padding: "16px 18px",
            background: "var(--surface-card)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
            <strong>Bobina ativa — instalada em {formatDate(roll.installedAtMs)}</strong>
            {overdue ? (
              <Tag color="var(--color-coral, #C4453A)">Já passou de 30m — trocar</Tag>
            ) : forecast.daysToEmpty != null ? (
              <Tag color="var(--color-amber, #C99020)">{Math.max(0, Math.round(forecast.daysToEmpty))} dias restantes</Tag>
            ) : (
              <Tag color="var(--text-muted)">Sem histórico suficiente ainda</Tag>
            )}
          </div>

          <div style={{ height: "10px", borderRadius: "99px", background: "var(--surface-sunken)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${percentUsed}%`,
                background: overdue ? "var(--color-coral, #C4453A)" : "var(--color-teal)",
                transition: "width 0.3s ease",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", fontSize: "13px", color: "var(--text-muted)" }}>
            <span>
              {formatM(roll.consumedMm)}m usados de {formatM(roll.rollLengthMm)}m
            </span>
            <span>
              {forecast.avgDailyMm > 0 ? `~${formatM(forecast.avgDailyMm)}m/dia` : "ainda sem ritmo de consumo calculado"}
            </span>
            <span>
              {forecast.forecastDateMs != null ? `Previsão de acabar: ${formatDate(forecast.forecastDateMs)}` : "Sem previsão de data ainda"}
            </span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
          Tamanho da nova bobina (m)
          <input
            value={newRollMeters}
            onChange={(e) => setNewRollMeters(e.target.value)}
            inputMode="decimal"
            style={{
              width: "100px",
              padding: "8px 10px",
              borderRadius: "10px",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-card)",
              color: "inherit",
            }}
          />
        </label>
        <Button variant="primary" onClick={changeRoll} loading={changing} disabled={changing || !unitId} style={{ borderRadius: "9999px" }}>
          Registrar troca de bobina
        </Button>
      </div>

      <details style={{ border: "1px solid var(--border-subtle)", borderRadius: "14px", padding: "12px 16px" }}>
        <summary style={{ cursor: "pointer", fontWeight: "bold", fontSize: "14px" }}>
          Histórico de trocas ({history.length})
        </summary>
        {history.length === 0 ? (
          <p style={{ color: "var(--text-muted)", marginTop: "10px" }}>Nenhuma troca registrada ainda para esta unidade.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px", fontSize: "13px" }}>
            {history.map((h) => {
              const days = h.finishedAtMs ? Math.max(1, Math.round((h.finishedAtMs - h.installedAtMs) / (24 * 60 * 60 * 1000))) : null;
              return (
                <div key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                  <span>
                    {formatDate(h.installedAtMs)} — {h.finishedAtMs ? formatDate(h.finishedAtMs) : "em uso"}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {formatM(h.consumedMm)}m de {formatM(h.rollLengthMm)}m{days ? ` · durou ${days} dia(s)` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </details>
    </div>
  );
}
