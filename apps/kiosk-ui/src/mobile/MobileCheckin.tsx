import { useEffect, useMemo, useRef, useState } from "react";
import { formatAccessCode, isValidCpf, isValidPhoneBr, normalizeCpf, normalizePhoneE164, planDurationMinutes } from "@facaamigos/domain";
import { Api } from "../api/client.js";
import type { ChildMatch, Plan } from "../api/client.js";
import { useToast } from "../state/ToastContext.js";
import { money, formatAge } from "../format.js";

type PreCheckin = Awaited<ReturnType<typeof Api.preCheckinList>>[number];

interface Done {
  childName: string;
  planName: string;
  accessCode: string;
  exitPin: string;
}

/**
 * Check-in em 3 toques.
 *
 * A regra que define esta tela: o plano SEMPRE exige toque explícito,
 * porque é o campo que define o preço. Tudo o mais pode vir preenchido —
 * nome, nascimento, responsável, cuidados sensoriais da última visita —
 * mas ninguém cobra R$ 110 de uma família porque o app "adivinhou".
 *
 * Criança nova e casos com cadastro incompleto NÃO são resolvidos aqui:
 * o formulário completo (foto, cupom, banco de horas, pacote, contrato de
 * guarda, carrinho) continua sendo a EntradaScreen. Duplicar aquilo num
 * celular só criaria uma segunda regra de negócio para divergir da
 * primeira.
 */
export function MobileCheckin({
  unitId,
  employeeId,
  onEscape,
  onDone,
}: {
  unitId: string;
  employeeId: string;
  onEscape: (screen: "ENTRADA" | "PAINEL", reason: string) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<"busca" | "plano" | "pronto">("busca");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ChildMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [pre, setPre] = useState<PreCheckin[] | null>(null);

  const [picked, setPicked] = useState<ChildMatch | null>(null);
  const [pickedPre, setPickedPre] = useState<PreCheckin | null>(null);
  const [care, setCare] = useState<{ notes: string; sensoryTags: string[] } | null>(null);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Api.preCheckinList(unitId)
      .then(setPre)
      .catch(() => setPre([]));
  }, [unitId]);

  useEffect(() => {
    Api.plans(unitId, "PLAYGROUND")
      .then(setPlans)
      .catch(() => setPlans([]));
  }, [unitId]);

  // Mesma janela de 220ms da EntradaScreen: curta o bastante para a lista
  // parecer instantânea, longa o bastante para não disparar uma RPC por
  // tecla digitada no balcão.
  useEffect(() => {
    const trimmed = query.trim();
    if (picked || trimmed.length < 2) {
      setMatches([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      Api.searchChildren(trimmed, unitId)
        .then(setMatches)
        .catch(() => setMatches([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => clearTimeout(handle);
  }, [query, picked, unitId]);

  const selectedPlan = useMemo(() => plans.find((p) => p.id === planId) ?? null, [plans, planId]);

  function reset() {
    setStep("busca");
    setPicked(null);
    setPickedPre(null);
    setCare(null);
    setPlanId(null);
    setQuery("");
    setDone(null);
  }

  function pickChild(match: ChildMatch) {
    // O check-in exige CPF e telefone válidos do responsável. Quando o
    // cadastro antigo não tem os dois, o caminho honesto é abrir a tela
    // completa — não inventar um campo de CPF no meio de um fluxo cujo
    // propósito inteiro é não ter formulário.
    if (!match.cpf || !isValidCpf(match.cpf) || !match.phone_e164 || !isValidPhoneBr(match.phone_e164)) {
      onEscape("ENTRADA", `O cadastro de ${match.full_name} está sem CPF ou telefone válido do responsável.`);
      return;
    }
    setPicked(match);
    setPickedPre(null);
    setStep("plano");
    setCare(null);
    Api.lastCareForChild(match.id)
      .then(setCare)
      .catch(() => setCare(null));
  }

  function pickPre(item: PreCheckin) {
    // Pré-cadastro em que a família escolheu um PACOTE, e não um plano
    // avulso, não pode ser confirmado aqui: vender um plano no lugar do
    // pacote cobraria a família duas vezes pelo mesmo saldo. O card do
    // Painel abre a Entrada completa já com esses dados preenchidos.
    if (!item.planId) {
      onEscape("PAINEL", `${item.childName} escolheu um pacote — confirme pelo card do Painel, que abre com os dados prontos.`);
      return;
    }
    // O pré-cadastro já traz plano escolhido pela família no QR de Acesso
    // Rápido. Ele ainda passa pela tela de plano: confirmar é conferir.
    setPickedPre(item);
    setPicked(null);
    setCare({ notes: item.notes ?? "", sensoryTags: item.sensoryTags ?? [] });
    setPlanId(item.planId);
    setStep("plano");
  }

  async function confirm() {
    if (!planId || submitting) return;
    setSubmitting(true);
    try {
      const child = pickedPre
        ? { fullName: pickedPre.childName, birthDate: pickedPre.birthDate, inclusiveEligible: pickedPre.inclusiveEligible }
        : { id: picked!.id, fullName: picked!.full_name, birthDate: picked!.birth_date, inclusiveEligible: false };

      const guardian = pickedPre
        ? { fullName: pickedPre.guardianName, cpf: normalizeCpf(pickedPre.cpf ?? ""), phoneE164: normalizePhoneE164(pickedPre.phoneE164) }
        : {
            fullName: picked!.guardian_name ?? "",
            cpf: normalizeCpf(picked!.cpf ?? ""),
            phoneE164: normalizePhoneE164(picked!.phone_e164 ?? ""),
          };

      const res = await Api.checkin({
        unitId,
        activity: "PLAYGROUND",
        planId,
        employeeId,
        child,
        guardian,
        notes: care?.notes || undefined,
        sensoryTags: care?.sensoryTags,
        preCheckinId: pickedPre?.id,
        preCheckinChildIndex: pickedPre ? pickedPre.childIndex : undefined,
      });

      setDone({
        childName: child.fullName,
        planName: selectedPlan?.name ?? "",
        accessCode: res.accessCode,
        exitPin: res.exitPin,
      });
      setStep("pronto");
      onDone();
      if (pickedPre) setPre((list) => (list ?? []).filter((p) => !(p.id === pickedPre.id && p.childIndex === pickedPre.childIndex)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível confirmar a entrada.");
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------- passo 1: busca ---------------- */

  if (step === "busca") {
    const showPre = query.trim().length < 2 && (pre?.length ?? 0) > 0;
    return (
      <div className="m-scroll">
        <div className="m-search">
          <span aria-hidden="true" style={{ fontSize: 17, color: "var(--text-muted)" }}>
            ⌕
          </span>
          <input
            ref={searchRef}
            className="m-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nome, CPF ou telefone"
            aria-label="Buscar criança"
            enterKeyHint="search"
            autoComplete="off"
          />
        </div>

        {showPre && (
          <>
            <p className="m-eyebrow" style={{ margin: "18px 0 10px" }}>
              Já preencheram pelo QR — só confirmar
            </p>
            <div className="m-stack" style={{ gap: 10 }}>
              {pre!.map((item) => (
                <button
                  key={`${item.id}-${item.childIndex}`}
                  type="button"
                  className="m-tap"
                  onClick={() => pickPre(item)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "var(--surface-card)",
                    border: "2px solid var(--color-primary)",
                    borderRadius: 20,
                    padding: 14,
                    font: "inherit",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <div className="m-grow">
                    <p style={{ margin: 0, fontSize: 15.5, fontWeight: 800 }}>{item.childName}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>
                      resp. {item.guardianName}
                      {item.totalChildren > 1 ? ` · ${item.childIndex + 1} de ${item.totalChildren} irmãos` : ""}
                    </p>
                    <p style={{ margin: "6px 0 0", fontSize: 11.5, fontWeight: 800, color: "var(--color-primary-hover)" }}>
                      {item.planName ?? (item.packageName ? `${item.packageName} · confirmar no Painel` : "sem plano escolhido")}
                    </p>
                  </div>
                  <span aria-hidden="true" style={{ fontSize: 20, color: "var(--color-gray-300)", flex: "none" }}>
                    ›
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {query.trim().length >= 2 && (
          <>
            <p className="m-eyebrow" style={{ margin: "18px 0 10px" }}>
              {searching ? "Procurando…" : `${matches.length} resultado(s)`}
            </p>
            <div className="m-stack" style={{ gap: 10 }}>
              {matches.map((match) => (
                <button
                  key={match.id}
                  type="button"
                  className="m-tap"
                  onClick={() => pickChild(match)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "var(--surface-card)",
                    border: "1px solid var(--color-gray-200)",
                    borderRadius: 20,
                    padding: 14,
                    font: "inherit",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <div className="m-grow">
                    <p style={{ margin: 0, fontSize: 15.5, fontWeight: 800 }}>{match.full_name}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>
                      {formatAge(match.birth_date)} · resp. {match.guardian_name ?? "—"}
                    </p>
                    {match.is_vip && (
                      <p style={{ margin: "6px 0 0", fontSize: 11.5, fontWeight: 800, color: "#996D18" }}>
                        VIP · {match.visits_in_window} visitas em 30 dias
                      </p>
                    )}
                  </div>
                  <span aria-hidden="true" style={{ fontSize: 20, color: "var(--color-gray-300)", flex: "none" }}>
                    ›
                  </span>
                </button>
              ))}
              {!searching && matches.length === 0 && (
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, fontWeight: 600, color: "var(--text-muted)" }}>
                  Ninguém com esse nome nesta unidade.
                </p>
              )}
            </div>
          </>
        )}

        <button
          type="button"
          className="m-tap"
          onClick={() => onEscape("ENTRADA", "Criança nova precisa do cadastro completo.")}
          style={{
            marginTop: 24,
            width: "100%",
            border: "2px dashed var(--color-gray-300)",
            borderRadius: 20,
            padding: 16,
            textAlign: "center",
            background: "var(--surface-card)",
            font: "inherit",
          }}
        >
          <p style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800 }}>Criança nova</p>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, fontWeight: 600, color: "var(--text-muted)" }}>
            Abre o cadastro completo — só quando ela realmente não existe
          </p>
        </button>
      </div>
    );
  }

  /* ---------------- passo 2: plano ---------------- */

  if (step === "plano") {
    const name = pickedPre ? pickedPre.childName : picked!.full_name;
    const detail = pickedPre
      ? `resp. ${pickedPre.guardianName}`
      : `${formatAge(picked!.birth_date)} · resp. ${picked!.guardian_name ?? "—"}`;

    return (
      <>
        <div className="m-scroll">
          <div
            className="m-row"
            style={{ background: "var(--surface-card)", border: "1px solid var(--color-gray-200)", borderRadius: 20, padding: 14, gap: 12 }}
          >
            <div className="m-grow">
              <p style={{ margin: 0, fontSize: 15.5, fontWeight: 800 }}>{name}</p>
              <p style={{ margin: "3px 0 0", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>{detail}</p>
            </div>
            <button
              type="button"
              onClick={reset}
              style={{ background: "none", border: "none", font: "inherit", fontSize: 12, fontWeight: 800, color: "var(--color-primary-hover)", cursor: "pointer", flex: "none" }}
            >
              Trocar
            </button>
          </div>

          {care && (care.sensoryTags.length > 0 || care.notes) && (
            <div
              style={{
                marginTop: 12,
                background: "rgba(46,207,181,.12)",
                border: "1px solid rgba(46,207,181,.45)",
                borderRadius: 16,
                padding: "12px 14px",
              }}
            >
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#1D8273" }}>
                {pickedPre ? "Cuidados informados pela família" : "Cuidados da última visita já vieram"}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.5, fontWeight: 600, color: "var(--text-secondary)" }}>
                {[care.sensoryTags.join(" · "), care.notes].filter(Boolean).join(" — ")}
              </p>
            </div>
          )}

          <p className="m-eyebrow" style={{ margin: "18px 0 10px" }}>
            Escolha o plano
          </p>
          <div className="m-stack" style={{ gap: 10 }}>
            {plans.map((plan) => {
              const on = planId === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  className="m-tap"
                  onClick={() => setPlanId(plan.id)}
                  aria-pressed={on}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    borderRadius: 20,
                    padding: 15,
                    width: "100%",
                    font: "inherit",
                    textAlign: "left",
                    background: on ? "rgba(240,25,107,0.08)" : "var(--surface-card)",
                    border: `2px solid ${on ? "var(--color-primary)" : "var(--color-gray-200)"}`,
                  }}
                >
                  <span style={{ width: 12, height: 12, borderRadius: "50%", flex: "none", background: plan.color }} />
                  <span className="m-grow">
                    <span style={{ display: "block", fontSize: 16.5, fontWeight: 800 }}>{plan.name}</span>
                    <span style={{ display: "block", marginTop: 3, fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>
                      {planDurationMinutes(plan)} min · excedente {money(plan.overageCentsPerMinute)}/min
                    </span>
                  </span>
                  <span className="m-num" style={{ fontFamily: "var(--font-display)", fontSize: 21, flex: "none" }}>
                    {money(plan.valueCents)}
                  </span>
                </button>
              );
            })}
            {plans.length === 0 && (
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "var(--text-muted)" }}>
                Nenhum plano ativo nesta unidade. Cadastre em Configurações.
              </p>
            )}
          </div>
        </div>

        <div
          style={{
            flex: "none",
            padding: "14px 20px calc(20px + env(safe-area-inset-bottom, 0px))",
            background: "var(--surface-card)",
            borderTop: "1px solid var(--color-gray-200)",
          }}
        >
          <button type="button" className="m-cta" disabled={!planId || submitting} onClick={() => void confirm()}>
            {submitting ? "Confirmando…" : planId ? "Confirmar entrada" : "Escolha um plano"}
          </button>
          <p style={{ margin: "9px 0 0", textAlign: "center", fontSize: 11.5, lineHeight: 1.4, fontWeight: 600, color: "var(--text-muted)" }}>
            Pulseira e recibo de guarda saem juntos, na mesma transação
          </p>
        </div>
      </>
    );
  }

  /* ---------------- passo 3: pronto ---------------- */

  return (
    <div className="m-scroll">
      <div style={{ marginTop: 14, textAlign: "center" }}>
        <div
          aria-hidden="true"
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "rgba(40,200,128,.14)",
            border: "2px solid var(--color-success)",
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            color: "#1A8454",
          }}
        >
          ✓
        </div>
        <p style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 28, lineHeight: 1.2 }}>Entrada confirmada</p>
        <p style={{ margin: "6px 0 0", fontSize: 14, fontWeight: 600, color: "var(--text-muted)" }}>
          {done?.childName} · {done?.planName}
        </p>
      </div>

      <div className="m-row" style={{ marginTop: 22, gap: 12 }}>
        <div className="m-card m-grow" style={{ borderRadius: 20, padding: 16, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Código</p>
          <p className="m-num" style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontSize: 22, color: "#1D8273", letterSpacing: ".04em" }}>
            {done ? formatAccessCode(done.accessCode) : ""}
          </p>
        </div>
        <div className="m-card m-grow" style={{ borderRadius: 20, padding: 16, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>PIN de saída</p>
          <p className="m-num" style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontSize: 24, color: "#996D18", letterSpacing: ".06em" }}>
            {done?.exitPin}
          </p>
        </div>
      </div>

      <div className="m-card" style={{ marginTop: 12, borderRadius: 20 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Impressão enfileirada</p>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
          Pulseira da criança + recibo de guarda dos pais. Se o check-in gravou, as duas saíram.
        </p>
      </div>

      <div style={{ marginTop: 24 }}>
        <button type="button" className="m-cta" onClick={reset}>
          Próxima família
        </button>
      </div>
    </div>
  );
}
