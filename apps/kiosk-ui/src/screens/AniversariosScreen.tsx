import { useEffect, useMemo, useState } from "react";
import { Card, Button, Badge } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Birthday } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Hash simples e estável (mesmo id -> sempre o mesmo índice) para a mensagem inicial de cada card. */
function stableIndex(id: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % mod;
}

function formatMessage(template: string, item: Birthday): string {
  return template
    .replaceAll("{crianca}", item.full_name)
    .replaceAll("{responsavel}", item.guardian_name)
    .replaceAll("{idade}", String(item.age_turning));
}

/**
 * Módulo de Aniversariantes — cada unidade só enxerga os aniversariantes
 * de crianças que já visitaram ELA (ver Api.birthdaysByUnit): o banco é
 * por unidade, uma unidade não vê os dados da outra.
 *
 * A mensagem de felicitação de cada card é sorteada de um pool de 1000
 * textos (fa_kiosk_birthday_messages) — sem template fixo escolhido na
 * tela, com "🔀 Trocar" para trocar antes de enviar. Depois de enviada, o
 * card some da lista (fa_kiosk_mark_birthday_sent) e só volta a aparecer
 * no aniversário do ano seguinte. A partir dos 11 anos a criança some do
 * módulo para sempre — corte de idade aplicado no próprio RPC.
 */
export function AniversariosScreen() {
  const { unit, employee } = useAppState();
  const toast = useToast();
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [items, setItems] = useState<Birthday[]>([]);
  const [messagePool, setMessagePool] = useState<string[]>([]);
  const [messageIndexById, setMessageIndexById] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Api.birthdayMessages()
      .then((rows) => setMessagePool(rows.map((r) => r.message)))
      .catch(() => setMessagePool([]));
  }, []);

  useEffect(() => {
    if (!unit) return;
    setLoading(true);
    Api.birthdaysByUnit(unit.id, month)
      .then((rows) => {
        setItems(rows);
        setMessageIndexById({});
      })
      .catch(() => {
        setItems([]);
        toast.error("Não foi possível carregar os aniversariantes desta unidade.");
      })
      .finally(() => setLoading(false));
  }, [unit, month]);

  const groups = useMemo(() => {
    const byDay = new Map<number, Birthday[]>();
    for (const item of items) {
      const list = byDay.get(item.day_of_month) ?? [];
      list.push(item);
      byDay.set(item.day_of_month, list);
    }
    return [...byDay.entries()].sort(([a], [b]) => a - b);
  }, [items]);

  function messageFor(item: Birthday): string {
    if (messagePool.length === 0) return "";
    const idx = messageIndexById[item.id] ?? stableIndex(item.id, messagePool.length);
    const template = messagePool[idx];
    return template ? formatMessage(template, item) : "";
  }

  function shuffleMessage(item: Birthday) {
    if (messagePool.length === 0) return;
    setMessageIndexById((prev) => {
      const current = prev[item.id] ?? stableIndex(item.id, messagePool.length);
      let next = Math.floor(Math.random() * messagePool.length);
      if (messagePool.length > 1) {
        while (next === current) next = Math.floor(Math.random() * messagePool.length);
      }
      return { ...prev, [item.id]: next };
    });
  }

  async function handleSendWhatsApp(item: Birthday) {
    const rawPhone = item.phone_e164.replace(/\D/g, "");
    if (!rawPhone) {
      toast.error("Este responsável não tem telefone cadastrado.");
      return;
    }
    if (!unit) return;
    const text = encodeURIComponent(messageFor(item));
    const url = `https://wa.me/${rawPhone}?text=${text}`;
    window.open(url, "_blank");

    // Marca como enviada este ano nesta unidade: o card some da lista e só
    // volta a aparecer no aniversário do ano que vem (fa_kiosk_birthdays_by_unit
    // já exclui quem tem registro em fa_kiosk_birthday_sends para o ano atual).
    try {
      await Api.markBirthdaySent(unit.id, item.id, employee?.id ?? null);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch {
      toast.error("A mensagem foi aberta no WhatsApp, mas não deu para marcar como enviada. O card pode reaparecer.");
    }
  }

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 6px 0", color: "var(--text-primary)" }}>
            🎂 Módulo de Aniversariantes
          </h1>
          <p style={{ color: "var(--text-muted)", margin: 0, fontSize: "14px" }}>
            Aniversariantes de {unit?.name ?? "sua unidade"} — envie uma mensagem acolhedora para o responsável.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--text-secondary)" }}>Mês:</span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            style={{
              padding: "8px 16px",
              borderRadius: "12px",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-card)",
              color: "var(--text-primary)",
              fontSize: "14px",
              fontWeight: "bold",
            }}
          >
            {MONTH_NAMES.map((m, idx) => (
              <option key={m} value={idx + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Carregando aniversariantes…</p>
      )}

      {!loading && items.length === 0 && (
        <Card style={{ padding: "24px", borderRadius: "16px", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", margin: 0 }}>
            Nenhum aniversariante encontrado para {MONTH_NAMES[month - 1]} nesta unidade.
          </p>
        </Card>
      )}

      {groups.map(([day, dayItems]) => (
        <div key={day} style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "15px", color: "var(--text-secondary)", margin: "0 0 12px 0" }}>
            Dia {day}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
            {dayItems.map((item) => (
              <Card
                key={item.id}
                style={{
                  padding: "20px",
                  borderRadius: "16px",
                  border: item.is_today ? "2px solid #EAB308" : "1px solid var(--border-subtle)",
                  boxShadow: item.is_today ? "0 0 12px rgba(234, 179, 8, 0.25)" : "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                  <div>
                    <h3 style={{ fontSize: "20px", margin: "0 0 4px 0", color: "var(--text-primary)" }}>
                      {item.full_name} {item.is_today ? "🎉" : ""}
                    </h3>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
                      Completa <strong>{item.age_turning} anos</strong> — Responsável: <strong>{item.guardian_name}</strong>
                    </p>
                  </div>
                  {item.is_today ? (
                    <Badge variant="amber">HOJE! 🎂</Badge>
                  ) : (
                    <Badge variant="teal">Dia {item.day_of_month}</Badge>
                  )}
                </div>

                <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 12px 0" }}>
                  📞 Contato: {item.phone_e164 || "Não cadastrado"}
                </p>

                <div
                  style={{
                    background: "var(--surface-sunken)",
                    padding: "12px 16px",
                    borderRadius: "12px",
                    fontSize: "13px",
                    color: "var(--text-secondary)",
                    borderLeft: "4px solid var(--color-primary)",
                    marginBottom: "12px",
                    minHeight: "48px",
                  }}
                >
                  {messageFor(item) || "Carregando mensagem…"}
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <Button variant="ghost" size="sm" onClick={() => shuffleMessage(item)} style={{ flexShrink: 0 }}>
                    🔀 Trocar
                  </Button>
                  <Button
                    variant={item.is_today ? "amber" : "teal"}
                    size="sm"
                    onClick={() => handleSendWhatsApp(item)}
                    style={{ flex: 1, fontWeight: "bold" }}
                  >
                    📱 Enviar Felicitação WhatsApp
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
