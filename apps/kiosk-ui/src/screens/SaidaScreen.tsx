import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Tag, HelpText, AsyncState } from "@facaamigos/ui";
import { formatAccessCode } from "@facaamigos/domain";
import { Api } from "../api/client.js";
import type { ActiveSessionEntry, ResolvedAccessCode } from "../api/client.js";
import { useActiveSessions } from "../api/useTick.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { QrScanner } from "../components/QrScanner.js";
import { CheckoutModal } from "../components/CheckoutModal.js";
import { GeminiSalesCard } from "../components/GeminiSalesCard.js";
import { generateCheckoutSuggestions, type CheckoutOffer } from "../lib/geminiAgent.js";
import { formatElapsed, money } from "../format.js";

/**
 * Saída pela câmera do celular — o caminho padrão de check-out.
 *
 * O desenho da tela responde a uma restrição de operação: quem faz a saída
 * está de pé, com o celular numa mão, uma criança e um responsável na frente,
 * e normalmente mais gente esperando. Então:
 *
 *   - a câmera abre sozinha, sem botão de "iniciar";
 *   - a leitura já traz a criança e o VALOR na tela, sem passo intermediário;
 *   - o caminho feliz é um único toque depois de bipar ("Cobrar e liberar");
 *   - o preço não é recalculado aqui: sai do mesmo motor que o Painel usa,
 *     conferido de novo pelo banco no instante do fechamento.
 *
 * Digitar o código à mão fica sempre visível como segunda via — é o que
 * salva a operação quando a câmera está bloqueada, suja ou o celular é
 * antigo demais. Se nem isso resolver (recibo perdido E etiqueta danificada),
 * o caminho é o Painel: cada card tem "Saída manual" com conferência de
 * documento.
 */

const REASON_MESSAGE: Record<ResolvedAccessCode["reason"], string> = {
  OK: "",
  PAUSADA: "Esta criança está com o tempo pausado. Retome no Painel antes de fechar.",
  CODIGO_INVALIDO: "Código não reconhecido. Confira se leu o QR da pulseira ou do recibo de guarda.",
  NAO_ENCONTRADO: "Nenhuma criança no parque com este código.",
  OUTRA_UNIDADE: "Esta pulseira é de outra operação. Troque de módulo para fechar esta saída.",
  JA_FINALIZADA: "Esta criança já saiu — o atendimento dela foi fechado.",
};

export interface SaidaScreenProps {
  entriesOverride?: ActiveSessionEntry[];
}

export function SaidaScreen({ entriesOverride }: SaidaScreenProps = {}) {
  const { unit, employee } = useAppState();
  const toast = useToast();
  const activeSessionsRes = useActiveSessions(entriesOverride ? null : (unit?.id ?? null));
  const entries = entriesOverride ?? activeSessionsRes.entries;
  const sessionsStatus = entriesOverride ? "ready" : activeSessionsRes.status;

  const [resolved, setResolved] = useState<ResolvedAccessCode | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [lastReleased, setLastReleased] = useState<string | null>(null);

  // A sessão vem da lista já carregada em vez de uma consulta nova: o valor a
  // cobrar precisa ser exatamente o mesmo que o Painel mostra no balcão, e
  // são no máximo algumas dezenas de crianças no espaço.
  const entry: ActiveSessionEntry | undefined = resolved?.sessionId
    ? entries.find((e) => e.session.id === resolved.sessionId)
    : undefined;

  const busyRef = useRef(false);

  const handleCode = useCallback(
    async (rawValue: string) => {
      if (!unit || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setProblem(null);
      setLastReleased(null);
      try {
        const result = await Api.resolveAccessCode(unit.id, rawValue, employee?.id);
        if (result.reason === "OK") {
          setResolved(result);
        } else {
          setResolved(null);
          setProblem(
            result.reason === "JA_FINALIZADA" && result.childName
              ? `${result.childName} já saiu — o atendimento dela foi fechado.`
              : REASON_MESSAGE[result.reason],
          );
        }
      } catch (err) {
        setResolved(null);
        setProblem(err instanceof Error ? err.message : "Não foi possível consultar este código.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [unit, employee?.id],
  );

  // A leitura resolvida vira nula se a criança sumir da lista de ativas
  // (outro terminal fechou a sessão enquanto esta tela estava aberta).
  useEffect(() => {
    if (resolved?.sessionId && sessionsStatus === "ready" && !entry && !checkoutOpen) {
      setResolved(null);
      setProblem("Esta sessão foi fechada em outro dispositivo.");
    }
  }, [resolved?.sessionId, sessionsStatus, entry, checkoutOpen]);

  const [checkoutOffers, setCheckoutOffers] = useState<CheckoutOffer[]>([]);
  const [loadingCheckoutOffers, setLoadingCheckoutOffers] = useState(false);

  useEffect(() => {
    if (resolved && entry && unit) {
      setLoadingCheckoutOffers(true);
      const elapsedMin = Math.round((entry.quote.timing.elapsedMs || 0) / 60_000);
      generateCheckoutSuggestions({
        childName: entry.session.child_name_snapshot,
        durationMinutes: elapsedMin,
        extraMinutes: entry.quote.timing.overMinutes,
        totalPaidCents: entry.quote.totalCents,
        unitName: unit.name,
      })
        .then(setCheckoutOffers)
        .finally(() => setLoadingCheckoutOffers(false));
    }
  }, [resolved, entry, unit]);

  function handleApplyCheckoutOffer(offer: CheckoutOffer) {
    toast.success(`Oferta "${offer.title}" recomendada ao responsável!`);
  }

  function clear() {
    setResolved(null);
    setProblem(null);
    setManualCode("");
  }

  async function submitManual() {
    if (!manualCode.trim()) return;
    await handleCode(manualCode);
  }

  if (!unit) return null;

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        padding: "clamp(12px, 3vw, 20px)",
        maxWidth: "560px",
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div>
        <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "clamp(20px, 5vw, 26px)" }}>Saída</h1>
        <HelpText>
          Aponte a câmera para o QR Code da pulseira da criança ou do recibo de guarda dos pais. A criança aparece na
          tela com o valor a pagar — confirme e ela está liberada.
        </HelpText>
      </div>

      <QrScanner onScan={handleCode} paused={busy || Boolean(resolved) || checkoutOpen} />

      {busy && <Tag color="var(--color-teal)">Consultando código…</Tag>}

      {lastReleased && !resolved && (
        <div
          role="status"
          style={{
            background: "rgba(29, 155, 132, 0.10)",
            border: "1px solid var(--color-teal)",
            color: "var(--color-teal-text)",
            borderRadius: "14px",
            padding: "14px 16px",
            fontWeight: "bold",
          }}
        >
          ✓ {lastReleased} liberado(a). Pode ler a próxima pulseira.
        </div>
      )}

      {problem && !resolved && (
        <div
          role="alert"
          style={{
            background: "rgba(232, 48, 48, 0.08)",
            border: "1px solid var(--color-error)",
            color: "var(--color-error-text)",
            borderRadius: "14px",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <span style={{ fontWeight: "bold" }}>{problem}</span>
          <Button variant="ghost" size="sm" onClick={clear} style={{ alignSelf: "flex-start" }}>
            Ler de novo
          </Button>
        </div>
      )}

      {resolved && entry && (
        <div
          style={{
            border: "2px solid var(--color-primary)",
            background: "var(--surface-card)",
            borderRadius: "18px",
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div>
            <strong style={{ fontSize: "22px", fontFamily: "var(--font-display)", display: "block" }}>
              {entry.session.child_name_snapshot}
            </strong>
            {entry.session.guardian_name_snapshot && (
              <span style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                Responsável: {entry.session.guardian_name_snapshot}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "13px", color: "var(--text-muted)" }}>
            <Tag color={entry.plan.color}>{entry.plan.name}</Tag>
            <span>Permanência: {formatElapsed(entry.quote.timing.elapsedMs)}</span>
            {entry.quote.timing.overMinutes > 0 && (
              <Tag color="var(--color-error)">+{entry.quote.timing.overMinutes} min excedente</Tag>
            )}
          </div>

          {/* Cuidados informados na entrada aparecem na saída de propósito:
              é o último momento em que a equipe fala com o responsável. */}
          {/* Sugestões de Retenção do Agente IA Gemini */}
          <GeminiSalesCard
            type="CHECKOUT"
            offers={checkoutOffers}
            loading={loadingCheckoutOffers}
            onApplyOffer={handleApplyCheckoutOffer}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              paddingTop: "10px",
              borderTop: "1px dashed var(--border-subtle)",
            }}
          >
            <span style={{ fontSize: "14px", color: "var(--text-muted)" }}>Total a pagar</span>
            <strong style={{ fontSize: "30px", color: "var(--color-primary-hover)", fontFamily: "var(--font-display)" }}>
              {money(entry.quote.totalCents)}
            </strong>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="ghost" size="lg" onClick={clear} style={{ borderRadius: "9999px" }}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => setCheckoutOpen(true)}
              style={{ borderRadius: "9999px", flex: 1 }}
              title="Cobrar e liberar a criança"
            >
              Cobrar e liberar
            </Button>
          </div>
        </div>
      )}

      {resolved && !entry && sessionsStatus === "loading" && (
        <AsyncState kind="loading" title="Carregando dados da criança…" />
      )}

      {/* Segunda via, sempre visível — não escondida atrás de "problemas?" */}
      <div
        style={{
          border: "1px solid var(--border-subtle)",
          borderRadius: "14px",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <strong style={{ fontSize: "14px" }}>Câmera não leu? Digite o PIN de saída</strong>
        <HelpText>
          O PIN de 4 dígitos está no recibo de guarda, ao lado do QR. Também aceita o código completo da pulseira (ex.:{" "}
          {formatAccessCode("K7M2P9QX3B7")}), se for mais rápido ler ele.
        </HelpText>
        <div style={{ display: "flex", gap: "8px" }}>
          <Input
            placeholder="0000"
            inputMode="numeric"
            value={manualCode}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitManual();
            }}
            style={{ flex: 1, letterSpacing: "2px", fontFamily: "var(--font-display)" }}
          />
          <Button variant="secondary" onClick={submitManual} loading={busy} disabled={!manualCode.trim() || busy}>
            Buscar
          </Button>
        </div>
      </div>

      <HelpText>
        Recibo perdido <strong>e</strong> etiqueta danificada? A liberação é feita no <strong>Painel</strong>, no botão
        "Saída manual" do card da criança, conferindo o documento do responsável.
      </HelpText>

      {checkoutOpen && entry && (
        <CheckoutModal
          entries={[entry]}
          onClose={() => setCheckoutOpen(false)}
          onDone={() => {
            setCheckoutOpen(false);
            setLastReleased(entry.session.child_name_snapshot);
            toast.success(`${entry.session.child_name_snapshot} liberado(a).`);
            setResolved(null);
            setManualCode("");
          }}
        />
      )}
    </div>
  );
}
