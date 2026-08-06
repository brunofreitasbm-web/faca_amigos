import { useEffect, useState } from "react";
import { Button, Card } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Employee, PontoRecord } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";

const KINDS = [
  { value: "ENTRADA", label: "Entrada" },
  { value: "INTERVALO_INICIO", label: "Início do intervalo" },
  { value: "INTERVALO_FIM", label: "Fim do intervalo" },
  { value: "SAIDA", label: "Saída" },
] as const;

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Bater ponto (Portaria MTP 671/2021 — ver packages/db-local/repositories/ponto.ts).
 * Sem edição/exclusão por desenho: cada marcação é um registro novo,
 * com NSR sequencial próprio.
 */
export function PontoScreen() {
  const { unit, employee: loggedEmployee } = useAppState();
  const toast = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [today, setToday] = useState<PontoRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Api.employees().then(setEmployees);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    Api.pontoHistory(selected.id, startOfDay.getTime(), Date.now()).then(setToday);
  }, [selected, message]);

  async function bater(kind: (typeof KINDS)[number]["value"]) {
    if (!selected || !unit || !loggedEmployee) return;
    setBusy(true);
    try {
      const res = await Api.ponto({ unitId: unit.id, employeeId: selected.id, kind, registeredByEmployeeId: loggedEmployee.id });
      setMessage(`Registrado às ${formatTime(res.atMs)} — NSR ${res.nsr}`);
    } catch (err) {
      // Sem catch aqui, uma falha ficava muda: a marcação (registro
      // legal, Portaria MTP 671/2021) podia não ter sido gravada e o
      // colaborador saía achando que bateu ponto.
      toast.error(err instanceof Error ? err.message : "Não foi possível registrar a marcação de ponto. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: "560px", margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Bater ponto</h1>

      {!selected ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {employees.map((emp) => (
            <Card key={emp.id} onClick={() => setSelected(emp)} style={{ cursor: "pointer", padding: "12px" }}>
              {emp.full_name}
            </Card>
          ))}
        </div>
      ) : (
        <>
          <h2>{selected.full_name}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            {KINDS.map((k) => (
              <Button key={k.value} variant="secondary" size="lg" disabled={busy} onClick={() => bater(k.value)}>
                {k.label}
              </Button>
            ))}
          </div>

          {message && <p style={{ color: "var(--color-teal-text)" }}>{message}</p>}

          <h3>Marcações de hoje</h3>
          <ul>
            {today.map((r) => (
              <li key={r.id}>
                {formatTime(r.at_ms)} — {r.kind} (NSR {r.nsr})
              </li>
            ))}
            {today.length === 0 && <li>Nenhuma marcação ainda.</li>}
          </ul>

          <Button variant="ghost" onClick={() => setSelected(null)}>
            trocar colaborador
          </Button>
        </>
      )}
    </div>
  );
}
