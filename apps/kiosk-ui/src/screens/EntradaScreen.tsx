import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Input, Select, DateInput, Tag, Badge, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Asset, ChildMatch, Coupon, Plan, UpsellOffer } from "../api/client.js";
import { UpsellOfferCard } from "../components/UpsellOfferCard.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import {
  normalizePhoneE164,
  formatPhoneBr,
  isValidPhoneBr,
  phoneDigitsBr,
  normalizeCpf,
  isValidCpf,
  formatCpf,
  planDurationMinutes,
  minutesUntilClosing,
  formatAccessCode,
} from "@facaamigos/domain";
import { money } from "../format.js";

const SENSORY_TAG_OPTIONS = [
  "Sensível a Ruído Alto",
  "Usa Abafador",
  "Acompanhante / Mediador 1:1",
  "Preferência pelo Cantinho da Calma",
  "Alergia Alimentar / Cuidados Especializados",
] as const;

/**
 * Entrada — check-in de balcão.
 *
 * A tela é organizada em torno de um número: quantas ações o operador
 * precisa fazer com a família esperando na frente dele. O caminho mais
 * comum do parque é uma criança que já veio antes, e para ela o fluxo
 * inteiro cabe em três toques:
 *
 *   1. digitar as primeiras letras do nome e tocar na criança encontrada
 *      (traz responsável, telefone, CPF, nascimento e os cuidados
 *      inclusivos da última visita);
 *   2. tocar no plano;
 *   3. tocar em "Confirmar entrada".
 *
 * O formulário completo de cadastro só aparece quando a criança realmente
 * não existe — não fica ocupando a tela nos outros 90% dos atendimentos.
 *
 * O plano continua exigindo um toque explícito de propósito. Ele é o único
 * campo que define quanto a família vai pagar, e um plano pré-selecionado
 * "para agilizar" é exatamente como se cobra o valor errado de alguém.
 *
 * Impressão: as duas vias (pulseira da criança + recibo de guarda dos pais)
 * são enfileiradas pelo próprio fa_checkin, na mesma transação do banco.
 * Esta tela não dispara impressão nenhuma — se o check-in gravou, as duas
 * saíram; se falhou, nenhuma saiu pela metade.
 */
export function EntradaScreen() {
  const { unit, employee } = useAppState();
  const toast = useToast();
  const activity = unit?.kind === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);

  // Busca única: nome da criança, nome do responsável, CPF ou telefone.
  // Antes eram quatro campos separados disputando a mesma consulta.
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ChildMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [matchedChild, setMatchedChild] = useState<ChildMatch | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const [cpf, setCpf] = useState("");
  const [childName, setChildName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [phone, setPhone] = useState("");
  const [favoriteAssetId, setFavoriteAssetId] = useState<string | null>(null);

  const [selectedSensoryTags, setSelectedSensoryTags] = useState<string[]>([]);
  const [customNotes, setCustomNotes] = useState("");
  const [showCare, setShowCare] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [showExtras, setShowExtras] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sessionId: string; accessCode: string; childName: string } | null>(null);

  // Oferta de upgrade da criança identificada. `null` cobre os dois casos
  // em que não há card: ainda não consultado e não elegível — a tela trata
  // os dois igual, então não vale um estado a mais para distingui-los.
  const [offer, setOffer] = useState<UpsellOffer | null>(null);

  const [lastGuardianId, setLastGuardianId] = useState<string | null>(null);
  const [closingTime, setClosingTime] = useState<string | undefined>(undefined);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!unit) return;
    Api.unitSetting(unit.id, "closing_time")
      .then((r) => setClosingTime(r.value ?? undefined))
      .catch(() => {});
  }, [unit]);

  // Reavalia quais planos ainda cabem até o fechamento conforme o tempo passa.
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const remainingMinutes = closingTime ? minutesUntilClosing(nowTick, closingTime) : null;

  useEffect(() => {
    if (!unit) return;
    setPlanId(null);
    Api.plans(unit.id, activity).then(setPlans);
    Api.coupons(unit.id).then(setCoupons);
    if (activity === "CARRINHO") Api.assets(unit.id).then(setAssets);
  }, [unit, activity]);

  // Busca única com debounce. Só dígitos quando o operador digitou um número:
  // a coluna de telefone é E.164 ("+5591982501215") e o texto mascarado
  // "(91) 98250-…" nunca casaria no ilike.
  useEffect(() => {
    const trimmed = query.trim();
    if (matchedChild || trimmed.length < 2) {
      setMatches([]);
      return;
    }
    const digits = trimmed.replace(/\D/g, "");
    const term = digits.length >= 3 && digits.length >= trimmed.length - 4 ? digits : trimmed;
    setSearching(true);
    const handle = setTimeout(() => {
      Api.searchChildren(term, unit?.id)
        .then(setMatches)
        .catch(() => setMatches([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => clearTimeout(handle);
  }, [query, matchedChild, unit?.id]);

  function pickMatch(match: ChildMatch) {
    setMatchedChild(match);
    setShowNewForm(false);
    setChildName(match.full_name);
    setBirthDate(match.birth_date);
    setPhone(match.phone_e164 ? formatPhoneBr(match.phone_e164) : "");
    setGuardianName(match.guardian_name ?? "");
    setCpf(match.cpf ? formatCpf(match.cpf) : "");
    setMatches([]);
    setFavoriteAssetId(null);
    setOffer(null);

    // Oferta de upgrade. Consultada aqui, e não no `submit`, porque o
    // script precisa chegar ao operador ANTES de a conversa virar "qual
    // plano?" — depois de escolhido o plano, propor outra coisa é desfazer
    // uma decisão já tomada na frente do cliente.
    //
    // `.catch(() => {})` de propósito: um erro aqui não pode aparecer como
    // falha do check-in. Sem oferta, o atendimento segue exatamente como
    // sempre seguiu.
    if (unit) {
      Api.upsellOffer(unit.id, match.id, null, employee?.id)
        .then((result) => setOffer(result.eligible ? result : null))
        .catch(() => setOffer(null));
    }

    // Cuidados da última visita vêm marcados: quem tem necessidade sensorial
    // continua tendo na visita seguinte.
    Api.lastCareForChild(match.id)
      .then((care) => {
        setSelectedSensoryTags(care.sensoryTags);
        setCustomNotes(care.notes);
        if (care.sensoryTags.length > 0 || care.notes) setShowCare(true);
      })
      .catch(() => {});

    if (activity === "CARRINHO") {
      Api.lastAssetForChild(match.id)
        .then((r) => {
          setFavoriteAssetId(r.assetId);
          // Carrinho preferido já selecionado quando está livre — um toque a menos.
          if (r.assetId && assets.find((a) => a.id === r.assetId)?.status === "DISPONIVEL") {
            setAssetId(r.assetId);
          }
        })
        .catch(() => {});
    }
  }

  function startNewChild() {
    setShowNewForm(true);
    setMatchedChild(null);
    setMatches([]);
    setOffer(null);
    // O que o operador já digitou na busca quase sempre é o nome da criança.
    if (query.trim() && !/\d/.test(query)) setChildName(query.trim());
  }

  function toggleSensoryTag(tag: string) {
    setSelectedSensoryTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function resetForNextChild(keepGuardian: boolean) {
    setQuery("");
    setMatches([]);
    setMatchedChild(null);
    setShowNewForm(false);
    setOffer(null);
    setChildName("");
    setBirthDate("");
    setSelectedSensoryTags([]);
    setCustomNotes("");
    setShowCare(false);
    setPlanId(null);
    setCouponCode("");
    setShowExtras(false);
    setFavoriteAssetId(null);
    if (!keepGuardian) {
      setCpf("");
      setGuardianName("");
      setPhone("");
      setLastGuardianId(null);
    }
    searchRef.current?.focus();
  }

  const identified = Boolean(matchedChild) || showNewForm;
  const selectedPlan = plans.find((p) => p.id === planId);

  const readiness = useMemo(() => {
    if (!identified) return "Identifique a criança para continuar";
    if (!childName.trim()) return "Informe o nome da criança";
    if (!birthDate) return "Informe a data de nascimento";
    if (!guardianName.trim()) return "Informe o nome do responsável";
    if (!isValidCpf(cpf)) return "CPF do responsável inválido";
    if (!isValidPhoneBr(phone)) return "WhatsApp do responsável inválido";
    if (!planId) return "Escolha o plano de permanência";
    if (activity === "CARRINHO" && !assetId) return "Escolha o carrinho";
    return null;
  }, [identified, childName, birthDate, guardianName, cpf, phone, planId, activity, assetId]);

  async function submit() {
    if (!unit || !employee || readiness) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await Api.checkin({
        unitId: unit.id,
        activity,
        assetId: assetId ?? undefined,
        planId: planId!,
        employeeId: employee.id,
        child: { id: matchedChild?.id, fullName: childName.trim(), birthDate, inclusiveEligible: false },
        guardian: {
          id: lastGuardianId ?? undefined,
          fullName: guardianName.trim(),
          cpf: normalizeCpf(cpf),
          phoneE164: normalizePhoneE164(phone),
        },
        couponCode: couponCode || undefined,
        notes: customNotes.trim() || undefined,
        sensoryTags: selectedSensoryTags,
      });

      setDone({ sessionId: res.sessionId, accessCode: res.accessCode, childName: childName.trim() });
      setLastGuardianId(res.guardianId);
      resetForNextChild(true);

      if (activity === "CARRINHO") {
        // Fora do try do check-in de propósito: a entrada já foi gravada, e
        // uma falha só em recarregar a lista de carrinhos não pode virar
        // "erro ao fazer check-in" na tela.
        try {
          const freshAssets = await Api.assets(unit.id);
          setAssets(freshAssets);
          setAssetId(null);
        } catch {
          toast.error("Entrada registrada, mas não foi possível atualizar a lista de carrinhos — atualize a tela antes da próxima.");
        }
      } else {
        setAssetId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registrar a entrada");
    } finally {
      setSubmitting(false);
    }
  }

  async function reprint() {
    if (!done || !employee) return;
    try {
      await Api.reimprimirEntrada(done.sessionId, employee.id);
      toast.success("Pulseira e recibo reenviados para a impressora.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível reimprimir.");
    }
  }

  if (!unit) return null;

  const phoneDigits = phoneDigitsBr(phone);
  const phoneLooksComplete =
    phoneDigits.length === 11 || (phoneDigits.length === 10 && !phoneDigits.slice(2).startsWith("9"));
  const phoneInvalid = phoneLooksComplete && !isValidPhoneBr(phone);

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <h1 style={{ fontFamily: "var(--font-display)", margin: 0 }}>Entrada</h1>
        <HelpText>
          Busque a criança pelo nome, CPF ou telefone; toque no plano; confirme. A pulseira e o recibo de guarda saem
          juntos, automaticamente.
        </HelpText>
      </div>

      {/* Confirmação da entrada anterior — fica visível enquanto o operador
          já começa a próxima criança, porque é onde está o código que ele
          pode precisar ditar se a impressora falhar. */}
      {done && (
        <div
          role="status"
          style={{
            border: "2px solid var(--color-teal)",
            background: "rgba(29, 155, 132, 0.08)",
            borderRadius: "16px",
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: "200px" }}>
            <strong style={{ display: "block", color: "var(--color-teal-text)" }}>
              ✓ {done.childName} está no parque
            </strong>
            <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              Pulseira e recibo de guarda enviados para impressão. Código:{" "}
              <strong style={{ fontFamily: "var(--font-display)", letterSpacing: "1px" }}>
                {formatAccessCode(done.accessCode)}
              </strong>
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={reprint} title="Reenviar as duas vias para a impressora">
            🖨️ Reimprimir
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDone(null)} aria-label="Dispensar aviso">
            ✕
          </Button>
        </div>
      )}

      {/* Oferta de upgrade — acima de tudo, inclusive do nome da criança.
          É o único elemento laranja do fluxo de Entrada, e some assim que
          o operador registra o aceite ou a recusa. */}
      {offer && <UpsellOfferCard offer={offer} onResolved={() => setOffer(null)} />}

      {/* ---------------------------------------------------------------- */}
      {/* 1. Quem é a criança                                              */}
      {/* ---------------------------------------------------------------- */}
      <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>1. Quem é a criança</h2>

        {matchedChild ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 14px",
              border: "2px solid var(--color-teal)",
              borderRadius: "14px",
              background: "rgba(29, 155, 132, 0.06)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: "200px" }}>
              <strong style={{ fontSize: "17px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {childName}
                {matchedChild?.is_vip && (
                  <Badge variant="vip" title={`${matchedChild.visits_in_window} visitas nos últimos 30 dias`}>
                    ★ VIP
                  </Badge>
                )}
              </strong>
              <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                {guardianName}
                {phone ? ` · ${phone}` : ""}
                {cpf ? ` · ${cpf}` : ""}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => resetForNextChild(false)} title="Buscar outra criança">
              Trocar
            </Button>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <Input
              ref={searchRef}
              label="Buscar por nome, CPF ou telefone"
              placeholder="Ex.: Helena, 000.000.000-00, 91982501215"
              value={query}
              autoFocus
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
            />
            {(matches.length > 0 || (query.trim().length >= 2 && !searching)) && !showNewForm && (
              <div
                className="match-suggestions"
                style={{
                  position: "absolute",
                  zIndex: 10,
                  background: "var(--surface-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "12px",
                  width: "100%",
                  boxShadow: "var(--shadow-md)",
                  overflow: "hidden",
                }}
              >
                {matches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => pickMatch(m)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 14px",
                      cursor: "pointer",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border-subtle)",
                      font: "inherit",
                    }}
                  >
                    <strong style={{ fontSize: "15px", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                      {m.full_name}
                      {m.is_vip && (
                        <Badge variant="vip" title={`${m.visits_in_window} visitas nos últimos 30 dias`}>
                          ★ VIP
                        </Badge>
                      )}
                    </strong>
                    <br />
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      {m.guardian_name ?? "sem responsável"}
                      {m.cpf ? ` · ${formatCpf(m.cpf)}` : ""}
                      {m.phone_e164 ? ` · ${formatPhoneBr(m.phone_e164)}` : ""}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={startNewChild}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    cursor: "pointer",
                    background: "var(--surface-sunken)",
                    border: "none",
                    font: "inherit",
                    fontWeight: "bold",
                    color: "var(--color-primary-hover)",
                  }}
                >
                  ＋ Não está na lista — cadastrar criança nova
                </button>
              </div>
            )}
          </div>
        )}

        {!matchedChild && !showNewForm && query.trim().length < 2 && (
          <Button variant="ghost" size="sm" onClick={startNewChild} style={{ alignSelf: "flex-start" }}>
            ＋ Primeira vez aqui — cadastrar
          </Button>
        )}

        {showNewForm && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", border: "1px solid var(--border-subtle)", borderRadius: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: "14px" }}>Cadastro novo</strong>
              <Button variant="ghost" size="sm" onClick={() => resetForNextChild(false)}>
                Voltar para a busca
              </Button>
            </div>
            <Input label="Nome da criança" placeholder="Nome completo" value={childName} onChange={(e) => setChildName(e.target.value)} />
            <DateInput label="Data de nascimento" value={birthDate} onChange={setBirthDate} />
            <Input label="Nome do responsável" placeholder="Pai, mãe ou acompanhante" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
            <Input label="CPF do responsável" placeholder="000.000.000-00" inputMode="numeric" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} />
            {cpf.length === 14 && !isValidCpf(cpf) && <Tag color="var(--color-error)">CPF inválido</Tag>}
            <Input
              label="WhatsApp do responsável"
              placeholder="(91) 98250-1215"
              inputMode="numeric"
              maxLength={15}
              value={phone}
              onChange={(e) => setPhone(formatPhoneBr(e.target.value))}
            />
            {phoneInvalid && <Tag color="var(--color-error)">WhatsApp inválido — DDD + número, com o 9 do celular</Tag>}
          </div>
        )}

        {lastGuardianId && !matchedChild && !showNewForm && (
          <Tag color="var(--color-teal)" title="Os dados do responsável seguem preenchidos para o irmão/irmã">
            ➕ Mesmo responsável ({guardianName}) — busque ou cadastre a próxima criança
          </Tag>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* 2. Plano                                                         */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 8px 0" }}>2. Plano de permanência</h2>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {plans.map((plan) => {
            const fits = remainingMinutes === null || planDurationMinutes(plan) <= remainingMinutes;
            return (
              <Card
                key={plan.id}
                onClick={() => fits && setPlanId(plan.id)}
                title={fits ? undefined : `Não cabe até o fechamento — faltam ${Math.max(0, remainingMinutes ?? 0)} min`}
                style={{
                  cursor: fits ? "pointer" : "not-allowed",
                  opacity: fits ? 1 : 0.4,
                  padding: "14px 18px",
                  minWidth: "150px",
                  borderRadius: "16px",
                  border: planId === plan.id ? "2px solid var(--color-primary)" : "1px solid var(--border-subtle)",
                  background: planId === plan.id ? "rgba(240, 25, 107, 0.06)" : "var(--surface-card)",
                }}
              >
                <strong style={{ fontSize: "16px", display: "block" }}>{plan.name}</strong>
                <div style={{ fontSize: "18px", color: "var(--color-primary-hover)", fontWeight: "bold", marginTop: "2px" }}>
                  {money(plan.valueCents)}
                </div>
                {!fits && <div style={{ fontSize: "11px", color: "var(--color-error-text)", fontWeight: "bold" }}>Não cabe até o fechamento</div>}
              </Card>
            );
          })}
        </div>
      </section>

      {activity === "CARRINHO" && (
        <section>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 8px 0" }}>3. Carrinho</h2>
          {favoriteAssetId === assetId && assetId && (
            <Tag color="var(--color-teal)" style={{ marginBottom: "8px" }}>
              Carrinho de sempre já reservado
            </Tag>
          )}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {assets.map((asset) => (
              <Card
                key={asset.id}
                onClick={() => asset.status === "DISPONIVEL" && setAssetId(asset.id)}
                style={{
                  cursor: asset.status === "DISPONIVEL" ? "pointer" : "not-allowed",
                  opacity: asset.status === "DISPONIVEL" ? 1 : 0.4,
                  padding: "14px",
                  borderRadius: "16px",
                  border: assetId === asset.id ? "2px solid var(--color-primary)" : "1px solid var(--border-subtle)",
                }}
              >
                <span style={{ fontSize: "26px" }}>{asset.emoji}</span> {asset.name}
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Cuidados inclusivos — recolhido, mas nunca escondido              */}
      {/* ---------------------------------------------------------------- */}
      <section style={{ border: "1px solid var(--border-subtle)", borderRadius: "14px", padding: "12px 14px" }}>
        <button
          type="button"
          onClick={() => setShowCare((v) => !v)}
          style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "none", cursor: "pointer", font: "inherit", padding: 0 }}
        >
          <strong style={{ fontSize: "15px" }}>
            🧩 Cuidados inclusivos
            {selectedSensoryTags.length > 0 && (
              <span style={{ marginLeft: "8px", fontSize: "12px", color: "var(--color-teal-text)" }}>
                {selectedSensoryTags.length} marcado(s)
              </span>
            )}
          </strong>
          <span aria-hidden style={{ color: "var(--text-muted)" }}>{showCare ? "▲" : "▼"}</span>
        </button>

        {showCare && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
            <HelpText>
              Estas informações são impressas na pulseira e no recibo — é assim que o monitor no salão fica sabendo.
            </HelpText>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {SENSORY_TAG_OPTIONS.map((tag) => {
                const isSelected = selectedSensoryTags.includes(tag);
                return (
                  <Button
                    key={tag}
                    type="button"
                    variant={isSelected ? "teal" : "ghost"}
                    size="sm"
                    onClick={() => toggleSensoryTag(tag)}
                    style={{ borderRadius: "9999px" }}
                  >
                    {isSelected ? "✓ " : "+ "}
                    {tag}
                  </Button>
                );
              })}
            </div>
            <Input
              label="Outras observações (opcional)"
              placeholder="Ex: alergia a corantes, brinquedo favorito..."
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
            />
          </div>
        )}
      </section>

      {/* Cupom fica atrás de um toque: é exceção, não rotina. */}
      <section>
        {!showExtras ? (
          <Button variant="ghost" size="sm" onClick={() => setShowExtras(true)}>
            ＋ Aplicar cupom de desconto
          </Button>
        ) : (
          <Select label="Cupom de desconto / parceria" value={couponCode} onChange={(e) => setCouponCode(e.target.value)}>
            <option value="">Nenhum</option>
            {coupons.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code}
                {c.description ? ` — ${c.description}` : ""}
              </option>
            ))}
          </Select>
        )}
      </section>

      {error && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{error}</p>}

      {/* Barra de confirmação: sempre visível no fim do fluxo, com o total
          que a família vai ver e o motivo exato do bloqueio, se houver. */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "var(--surface-card)",
          borderTop: "1px solid var(--border-subtle)",
          padding: "12px 0",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {readiness && <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{readiness}</span>}
        <Button
          variant="primary"
          size="lg"
          loading={submitting}
          disabled={submitting || Boolean(readiness)}
          onClick={submit}
          style={{ borderRadius: "9999px", padding: "16px" }}
          title="Registrar a entrada e imprimir a pulseira e o recibo de guarda"
        >
          Confirmar entrada{selectedPlan ? ` — ${money(selectedPlan.valueCents)}` : ""}
        </Button>
      </div>
    </div>
  );
}
