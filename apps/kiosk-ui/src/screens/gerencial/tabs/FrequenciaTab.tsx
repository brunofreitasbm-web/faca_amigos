import { useEffect, useMemo, useState } from "react";
import { Button, Card, HelpText, Modal, Select, Tabs } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Employee } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { supabase } from "../../../lib/supabase/client.js";
import { computeWorkedMinutes, dateTimeLabelsInTz, type PontoKind } from "../../../lib/ponto.js";
import { exportFrequenciaCsv } from "../../../lib/csvExport.js";
import { computeDatesForPeriod, isoDate } from "../../RelatorioScreen.js";
import type { PeriodPreset } from "../../RelatorioScreen.js";
import { ROLE_LABEL } from "../../../auth/capabilities.js";

interface FrequenciaRecord {
  id: string;
  employee_id: string;
  unit_id: string;
  kind: PontoKind;
  nsr: number;
  at_ms: number;
  punch_photo_path: string | null;
  full_name: string;
  role: Employee["role"] | null;
}

const KIND_LABEL: Record<PontoKind, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  INTERVALO_INICIO: "Início intervalo",
  INTERVALO_FIM: "Fim intervalo",
};

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * Controle de Frequência — módulo admin dedicado a acompanhar marcações de
 * ponto (equipe toda, CLT e Estagiário juntos), separado da Folha de Ponto
 * em Relatórios: aqui o foco é o dia a dia (quem bateu o quê, quando, com
 * qual foto), não o fechamento mensal para pagamento. Espelha o
 * FrequenciaTab.jsx do sistema irmão Porto Terapia — tempo real,
 * comparação de foto, resumo de horas.
 */
export function FrequenciaTab() {
  const { units } = useAppState();
  const unitTimezones = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u.timezone])), [units]);
  const [unitFilter, setUnitFilter] = useState<string>("ALL");
  const [period, setPeriod] = useState<PeriodPreset>("today");
  const [customFrom, setCustomFrom] = useState(() => isoDate(new Date()));
  const [customTo, setCustomTo] = useState(() => isoDate(new Date()));
  const [viewMode, setViewMode] = useState<"REGISTROS" | "RESUMO">("REGISTROS");
  const [records, setRecords] = useState<FrequenciaRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [photoTarget, setPhotoTarget] = useState<FrequenciaRecord | null>(null);

  const { from, to } = computeDatesForPeriod(period, customFrom, customTo);
  const fromMs = useMemo(() => new Date(`${from}T00:00:00`).getTime(), [from]);
  const toMs = useMemo(() => new Date(`${to}T00:00:00`).getTime() + 86_400_000, [to]);
  const unitId = unitFilter === "ALL" ? null : unitFilter;

  useEffect(() => {
    Api.allEmployees().then(setEmployees);
  }, []);

  function load() {
    setLoading(true);
    Api.frequenciaRecords(unitId, fromMs, toMs)
      .then(setRecords)
      .finally(() => setLoading(false));
  }
  useEffect(load, [unitId, fromMs, toMs]);

  // Tempo real: nova marcação bate na tabela (mesma origem do quiosque)
  // aparece aqui sem precisar recarregar a página — quem acompanha a
  // frequência ao vivo (recepção, RH) vê o estagiário/colaborador chegando
  // na hora que acontece, não só quando decide atualizar.
  useEffect(() => {
    const channel = supabase()
      .channel(unitId ? `fa_kiosk_frequencia_${unitId}` : "fa_kiosk_frequencia_all")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "fa_kiosk_ponto_records",
          ...(unitId ? { filter: `unit_id=eq.${unitId}` } : {}),
        },
        () => load(),
      )
      .subscribe();
    return () => {
      void supabase().removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  const hoursSummary = useMemo(() => {
    const byEmployee = new Map<string, FrequenciaRecord[]>();
    for (const r of records) {
      byEmployee.set(r.employee_id, [...(byEmployee.get(r.employee_id) ?? []), r]);
    }
    return Array.from(byEmployee.entries())
      .map(([employeeId, recs]) => {
        const { minutes, incomplete } = computeWorkedMinutes(recs);
        return { employeeId, fullName: recs[0]!.full_name, role: recs[0]!.role, minutes, incomplete };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [records]);

  async function openPhoto(r: FrequenciaRecord) {
    setPhotoTarget(r);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "20px" }}>Controle de Frequência</h2>
          <HelpText style={{ margin: 0 }}>Marcações de ponto ao vivo — CLT e Estagiários, por unidade e período.</HelpText>
        </div>
        <Button variant="secondary" size="sm" disabled={records.length === 0} onClick={() => exportFrequenciaCsv(records, unitTimezones)}>
          ⬇️ Exportar CSV
        </Button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "12px", padding: "12px", marginBottom: "16px", borderRadius: "var(--radius-lg)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)" }}>
        <div style={{ width: "200px" }}>
          <Select label="Unidade" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
            <option value="ALL">Todas as unidades</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div style={{ width: "200px" }}>
          <Select label="Período" value={period} onChange={(e) => setPeriod(e.target.value as PeriodPreset)}>
            <option value="today">Hoje</option>
            <option value="yesterday">Ontem</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
          </Select>
        </div>
        <Tabs
          value={viewMode}
          onChange={setViewMode}
          tabs={[
            { value: "REGISTROS", label: "Registros" },
            { value: "RESUMO", label: "Resumo de horas" },
          ]}
        />
      </div>

      {viewMode === "REGISTROS" ? (
        <Card style={{ padding: "8px", overflowX: "auto" }}>
          <table className="report-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Papel</th>
                <th>Unidade</th>
                <th>Marcação</th>
                <th>Horário</th>
                <th>Foto</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const { dateLabel, timeLabel } = dateTimeLabelsInTz(r.at_ms, unitTimezones[r.unit_id]);
                return (
                <tr key={r.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>{r.full_name}</span>
                      {r.role === "ESTAGIARIO" && (
                        <span style={{ fontSize: "11px", fontWeight: "bold", background: "rgba(180, 83, 9, 0.15)", color: "#b45309", padding: "1px 6px", borderRadius: "9999px" }}>
                          🎓 Estagiário
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{r.role ? ROLE_LABEL[r.role] : "—"}</td>
                  <td>{units.find((u) => u.id === r.unit_id)?.name ?? "—"}</td>
                  <td>{KIND_LABEL[r.kind]}</td>
                  <td>{dateLabel} {timeLabel}</td>
                  <td style={{ textAlign: "center" }}>
                    {r.punch_photo_path ? (
                      <Button variant="ghost" size="sm" onClick={() => openPhoto(r)} title="Ver foto da marcação">
                        📷
                      </Button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                );
              })}
              {!loading && records.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                    Nenhuma marcação no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card style={{ padding: "8px", overflowX: "auto" }}>
          <table className="report-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Papel</th>
                <th>Horas trabalhadas no período</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {hoursSummary.map((s) => (
                <tr key={s.employeeId}>
                  <td>{s.fullName}</td>
                  <td>{s.role ? ROLE_LABEL[s.role] : "—"}</td>
                  <td style={{ textAlign: "center" }}>{formatMinutes(s.minutes)}</td>
                  <td style={{ textAlign: "center", color: s.incomplete ? "var(--color-amber-text)" : "var(--color-teal-text)" }}>
                    {s.incomplete ? "⚠️ Jornada incompleta" : "✓ Completa"}
                  </td>
                </tr>
              ))}
              {hoursSummary.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                    Nenhuma marcação no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {photoTarget && (
        <PhotoCompareModal
          record={photoTarget}
          employee={employees.find((e) => e.id === photoTarget.employee_id) ?? null}
          onClose={() => setPhotoTarget(null)}
        />
      )}
    </div>
  );
}

function PhotoCompareModal({
  record,
  employee,
  onClose,
}: {
  record: FrequenciaRecord;
  employee: Employee | null;
  onClose: () => void;
}) {
  const [punchUrl, setPunchUrl] = useState<string | null>(null);
  const [enrolledUrl, setEnrolledUrl] = useState<string | null>(null);

  useEffect(() => {
    if (record.punch_photo_path) Api.pontoFotoSignedUrl(record.punch_photo_path).then(setPunchUrl);
    if (employee?.face_enrolled_photo_path) Api.pontoFotoSignedUrl(employee.face_enrolled_photo_path).then(setEnrolledUrl);
  }, [record.punch_photo_path, employee?.face_enrolled_photo_path]);

  return (
    <Modal title={`Foto da marcação — ${record.full_name}`} onClose={onClose} maxWidth="560px">
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "220px" }}>
          <HelpText>Tirada na marcação</HelpText>
          {punchUrl ? (
            <img src={punchUrl} alt="Foto da marcação" style={{ width: "100%", borderRadius: "var(--radius-lg, 16px)" }} />
          ) : (
            <p style={{ color: "var(--text-muted)" }}>Sem foto nesta marcação.</p>
          )}
        </div>
        <div style={{ flex: 1, minWidth: "220px" }}>
          <HelpText>Cadastro do rosto</HelpText>
          {enrolledUrl ? (
            <img src={enrolledUrl} alt="Foto de cadastro" style={{ width: "100%", borderRadius: "var(--radius-lg, 16px)" }} />
          ) : (
            <p style={{ color: "var(--text-muted)" }}>Colaborador sem rosto cadastrado.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
