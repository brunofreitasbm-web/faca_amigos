import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { formatAccessCode, isValidCpf, isValidPhoneBr, normalizeCpf, normalizePhoneE164 } from "@facaamigos/domain";
import { Api } from "../api/client.js";
import type { Asset, ChildMatch, Package, Plan } from "../api/client.js";
import { useToast } from "../state/ToastContext.js";
import { money, formatAge } from "../format.js";

type Step = "busca" | "veiculo" | "plano" | "pronto";
type Catalogo = "planos" | "pacotes";

interface Done {
  childName: string;
  offerName: string;
  accessCode: string;
  exitPin: string;
}

/**
 * Check-in do Circuito — mesmo motor da Entrada normal (fa_checkin), com
 * activity: "CARRINHO" e um veículo obrigatório. É por isso que o
 * check-in de 3 toques do Playground escapa para a tela completa neste
 * caso (ver MobileShell.entradaPrecisaDeAtivo): faltava o passo de
 * escolher o veículo, que este componente resolve nativamente.
 *
 * "4 categorias completas" do desenho original virou 2 abas reais —
 * Planos e Pacotes — porque é só isso que existe no banco para a
 * atividade CARRINHO (Api.plans/Api.packages). "Sessões"/"Locações" do
 * protótipo eram nomes fictícios para a mesma coisa.
 */
export function MobileCheckinCircuito({
  unitId,
  employeeId,
  onDone,
}: {
  unitId: string;
  employeeId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>("busca");

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ChildMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<ChildMatch | null>(null);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState<string | null>(null);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [catalogo, setCatalogo] = useState<Catalogo>("planos");
  const [planId, setPlanId] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [checklistOk, setChecklistOk] = useState({ capacete: false, instrucoes: false });

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    Api.assets(unitId).then(setAssets).catch(() => setAssets([]));
    Api.plans(unitId, "CARRINHO").then(setPlans).catch(() => setPlans([]));
    Api.packages(unitId, "CARRINHO").then(setPackages).catch(() => setPackages([]));
  }, [unitId]);

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
  const selectedPackage = useMemo(() => packages.find((p) => p.id === packageId) ?? null, [packages, packageId]);
  const offerReady = catalogo === "planos" ? Boolean(selectedPlan) : Boolean(selectedPackage);
  const checklistDone = checklistOk.capacete && checklistOk.instrucoes;

  function reset() {
    setStep("busca");
    setPicked(null);
    setAssetId(null);
    setPlanId(null);
    setPackageId(null);
    setChecklistOk({ capacete: false, instrucoes: false });
    setQuery("");
    setDone(null);
  }

  function pickChild(match: ChildMatch) {
    if (!match.cpf || !isValidCpf(match.cpf) || !match.phone_e164 || !isValidPhoneBr(match.phone_e164)) {
      toast.error(`O cadastro de ${match.full_name} está sem CPF ou telefone válido — use a Entrada completa.`);
      return;
    }
    setPicked(match);
    setStep("veiculo");
  }

  function parseFriendlyError(err: unknown): string {
    if (!(err instanceof Error)) return "Não foi possível liberar a pista.";
    const msg = err.message || "";
    if (msg.includes("ASSET_INDISPONIVEL")) return "Este veículo acabou de ser ocupado ou está indisponível. Escolha outro.";
    if (msg.includes("ASSET_OBRIGATORIO")) return "Por favor, escolha um veículo disponível para liberar a pista.";
    if (msg.includes("PLANO_INVALIDO")) return "O plano selecionado não é válido para a modalidade Circuito.";
    if (msg.includes("PACOTE_INVALIDO")) return "O pacote selecionado não é válido para a modalidade Circuito.";
    if (msg.includes("FORA_DO_HORARIO")) {
      const split = msg.split(":");
      return split.length > 1 ? split.slice(1).join(":").trim() : "O quiosque está fora do horário de atendimento.";
    }
    return msg || "Não foi possível liberar a pista.";
  }

  async function confirm() {
    if (!picked || !assetId || !offerReady || !checklistDone || submitting) return;
    setSubmitting(true);
    try {
      const res = await Api.checkin({
        unitId,
        activity: "CARRINHO",
        assetId,
        planId: catalogo === "planos" ? planId : null,
        packageId: catalogo === "pacotes" ? packageId : null,
        employeeId,
        child: { id: picked.id, fullName: picked.full_name, birthDate: picked.birth_date, inclusiveEligible: Boolean(picked?.inclusive_eligible) },
        guardian: {
          fullName: picked.guardian_name || "Responsável",
          cpf: normalizeCpf(picked.cpf ?? ""),
          phoneE164: normalizePhoneE164(picked.phone_e164 ?? ""),
        },
      });
      setDone({
        childName: picked.full_name,
        offerName: (catalogo === "planos" ? selectedPlan?.name : selectedPackage?.name) ?? "",
        accessCode: res.accessCode,
        exitPin: res.exitPin,
      });
      setStep("pronto");
      onDone();
    } catch (err) {
      toast.error(parseFriendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "busca") {
    return (
      <div className="m-scroll">
        <div className="m-search">
          <span aria-hidden="true" style={{ fontSize: 17, color: "var(--text-muted)" }}>⌕</span>
          <input
            className="m-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nome, CPF ou telefone"
            aria-label="Buscar criança"
            enterKeyHint="search"
            autoComplete="off"
          />
        </div>
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
                  style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--surface-card)", border: "1px solid var(--color-gray-200)", borderRadius: 20, padding: 14, font: "inherit", textAlign: "left", width: "100%" }}
                >
                  <div className="m-grow">
                    <p style={{ margin: 0, fontSize: 15.5, fontWeight: 800 }}>{match.full_name}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>
                      {formatAge(match.birth_date)} · resp. {match.guardian_name ?? "—"}
                    </p>
                  </div>
                  <span aria-hidden="true" style={{ fontSize: 20, color: "var(--color-gray-300)", flex: "none" }}>›</span>
                </button>
              ))}
              {!searching && matches.length === 0 && (
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "var(--text-muted)" }}>
                  Ninguém com esse nome. Criança nova ainda precisa da Entrada completa.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  if (step === "veiculo") {
    return (
      <>
        <div className="m-scroll">
          <div className="m-row" style={{ background: "var(--surface-card)", border: "1px solid var(--color-gray-200)", borderRadius: 16, padding: "12px 14px", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--surface-page)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, color: "var(--teal-ink, #1D8273)", flex: "none" }}>
              {picked!.full_name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{picked!.full_name}</p>
          </div>

          <p className="m-eyebrow" style={{ margin: "18px 0 10px" }}>Escolha o veículo</p>
          <div className="m-stack" style={{ gap: 10 }}>
            {assets.map((v) => {
              const disabled = v.status !== "DISPONIVEL";
              const on = assetId === v.id;
              const statusLabel = v.status === "DISPONIVEL" ? "Disponível" : v.status === "EM_USO" ? "Em uso" : "Manutenção";
              const statusColor = v.status === "DISPONIVEL" ? "#1A8454" : v.status === "EM_USO" ? "#996D18" : "#E61E1E";
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={disabled}
                  className={disabled ? "" : "m-tap"}
                  onClick={() => setAssetId(v.id)}
                  style={{
                    borderRadius: 18,
                    padding: "14px 16px",
                    width: "100%",
                    font: "inherit",
                    textAlign: "left",
                    background: disabled ? "var(--surface-page)" : on ? "rgba(240,25,107,0.08)" : "var(--surface-card)",
                    border: `2px solid ${on ? "var(--color-primary)" : "var(--color-gray-200)"}`,
                    opacity: disabled ? 0.6 : 1,
                  }}
                >
                  <div className="m-row" style={{ justifyContent: "space-between" }}>
                    <span style={{ fontSize: 15, fontWeight: 800 }}>{v.emoji} {v.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: statusColor }}>{statusLabel}</span>
                  </div>
                </button>
              );
            })}
            {assets.length === 0 && (
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "var(--text-muted)" }}>Nenhum veículo cadastrado nesta unidade.</p>
            )}
          </div>
        </div>
        <div style={{ flex: "none", padding: "14px 20px calc(20px + env(safe-area-inset-bottom, 0px))", background: "var(--surface-card)", borderTop: "1px solid var(--color-gray-200)" }}>
          <button type="button" className="m-cta" disabled={!assetId} onClick={() => setStep("plano")}>
            {assetId ? "Continuar" : "Escolha um veículo"}
          </button>
        </div>
      </>
    );
  }

  if (step === "plano") {
    const list = catalogo === "planos" ? plans : packages;
    return (
      <>
        <div className="m-scroll">
          <div className="m-row" style={{ gap: 6, marginBottom: 4 }}>
            {(["planos", "pacotes"] as Catalogo[]).map((c) => {
              const on = catalogo === c;
              return (
                <button
                  key={c}
                  type="button"
                  className="m-tap"
                  onClick={() => setCatalogo(c)}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    borderRadius: 9999,
                    padding: "9px 4px",
                    fontSize: 12,
                    fontWeight: 800,
                    background: on ? "var(--color-primary)" : "var(--surface-card)",
                    color: on ? "#fff" : "var(--text-secondary)",
                    border: `1.5px solid ${on ? "var(--color-primary)" : "var(--color-gray-200)"}`,
                  }}
                >
                  {c === "planos" ? "Planos avulsos" : "Pacotes"}
                </button>
              );
            })}
          </div>

          <div className="m-stack" style={{ gap: 10, marginTop: 14 }}>
            {catalogo === "planos"
              ? plans.map((p) => (
                  <button key={p.id} type="button" className="m-tap" onClick={() => setPlanId(p.id)} style={offerStyle(planId === p.id)}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", flex: "none", background: p.color }} />
                    <span className="m-grow">
                      <span style={{ display: "block", fontSize: 16, fontWeight: 800 }}>{p.name}</span>
                    </span>
                    <span className="m-num" style={{ fontFamily: "var(--font-display)", fontSize: 20, flex: "none" }}>{money(p.valueCents)}</span>
                  </button>
                ))
              : packages.map((p) => (
                  <button key={p.id} type="button" className="m-tap" onClick={() => setPackageId(p.id)} style={offerStyle(packageId === p.id)}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", flex: "none", background: p.color }} />
                    <span className="m-grow">
                      <span style={{ display: "block", fontSize: 16, fontWeight: 800 }}>{p.name}</span>
                      <span style={{ display: "block", marginTop: 3, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{p.benefitText}</span>
                    </span>
                    <span className="m-num" style={{ fontFamily: "var(--font-display)", fontSize: 20, flex: "none" }}>{money(p.priceCents)}</span>
                  </button>
                ))}
            {list.length === 0 && (
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "var(--text-muted)" }}>Nada ativo aqui ainda.</p>
            )}
          </div>

          <p className="m-eyebrow" style={{ margin: "22px 0 10px" }}>Checklist de segurança</p>
          <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--text-muted)" }}>Confirme os dois itens antes de liberar a pista</p>
          <div className="m-stack" style={{ gap: 8 }}>
            {(
              [
                ["capacete", "Capacete/proteção entregue e ajustado"],
                ["instrucoes", "Instruções de segurança da pista explicadas"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="m-tap m-row"
                onClick={() => setChecklistOk((prev) => ({ ...prev, [key]: !prev[key] }))}
                style={{ gap: 10, background: "var(--surface-card)", border: "1px solid var(--color-gray-200)", borderRadius: 14, padding: "12px 14px", width: "100%", font: "inherit", textAlign: "left" }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    flex: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#fff",
                    background: checklistOk[key] ? "var(--color-primary)" : "transparent",
                    border: `2px solid ${checklistOk[key] ? "var(--color-primary)" : "var(--color-gray-300)"}`,
                  }}
                >
                  {checklistOk[key] ? "✓" : ""}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: "none", padding: "14px 20px calc(20px + env(safe-area-inset-bottom, 0px))", background: "var(--surface-card)", borderTop: "1px solid var(--color-gray-200)" }}>
          <button type="button" className="m-cta" disabled={!offerReady || !checklistDone || submitting} onClick={() => void confirm()}>
            {submitting ? "Liberando…" : "Liberar pista"}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="m-scroll">
      <div style={{ marginTop: 14, textAlign: "center" }}>
        <div aria-hidden="true" style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(40,200,128,.14)", border: "2px solid var(--color-success)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, color: "#1A8454" }}>✓</div>
        <p style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1.2 }}>Pista liberada</p>
        <p style={{ margin: "6px 0 0", fontSize: 14, fontWeight: 600, color: "var(--text-muted)" }}>{done?.childName} · {done?.offerName}</p>
      </div>
      <div className="m-row" style={{ marginTop: 22, gap: 12 }}>
        <div className="m-card m-grow" style={{ borderRadius: 20, padding: 16, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Código</p>
          <p className="m-num" style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontSize: 20, color: "#1D8273" }}>{done ? formatAccessCode(done.accessCode) : ""}</p>
        </div>
        <div className="m-card m-grow" style={{ borderRadius: 20, padding: 16, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>PIN de saída</p>
          <p className="m-num" style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontSize: 22, color: "#996D18" }}>{done?.exitPin}</p>
        </div>
      </div>
      <div style={{ marginTop: 24 }}>
        <button type="button" className="m-cta" onClick={reset}>Próxima criança</button>
      </div>
    </div>
  );
}

function offerStyle(on: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 14,
    borderRadius: 18,
    padding: 14,
    width: "100%",
    font: "inherit",
    textAlign: "left",
    background: on ? "rgba(240,25,107,0.08)" : "var(--surface-card)",
    border: `2px solid ${on ? "var(--color-primary)" : "var(--color-gray-200)"}`,
  };
}
