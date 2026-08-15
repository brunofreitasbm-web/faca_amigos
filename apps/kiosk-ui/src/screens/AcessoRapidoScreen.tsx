import { useEffect, useState } from "react";
import { Button, Card, Checkbox, DateInput, Input, HelpText, Tag, BrandLockup, Modal } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Plan } from "../api/client.js";
import { AcompanharScreen } from "./AcompanharScreen.js";
import { SENSORY_TAG_OPTIONS } from "./EntradaScreen.js";
import {
  formatCpf,
  formatPhoneBr,
  isValidCpf,
  isValidPhoneBr,
  normalizeCpf,
  normalizePhoneE164,
} from "@facaamigos/domain";
import { generateMobileAcessoRapidoSuggestions, type MobileOffer } from "../lib/geminiAgent.js";
import { money } from "../format.js";

function planDurationMinutes(plan: { durationValue: number; durationUnit: "MINUTO" | "HORA" }): number {
  return plan.durationUnit === "HORA" ? plan.durationValue * 60 : plan.durationValue;
}

type FormOptions = {
  unitName: string;
  activity: "PLAYGROUND" | "CARRINHO";
  plans: Array<Pick<Plan, "id" | "name" | "valueCents" | "durationValue" | "durationUnit" | "color">>;
  termsText: string;
};

type ChildForm = {
  childName: string;
  birthDate: string;
  isNeurodivergent: boolean;
  sensoryTags: string[];
  customNotes: string;
};

const MAX_CHILDREN = 6;

function emptyChild(): ChildForm {
  return { childName: "", birthDate: "", isNeurodivergent: false, sensoryTags: [], customNotes: "" };
}

const STATUS_POLL_MS = 5000;

/**
 * QR Code de Acesso Rápido — cartaz fixo na entrada de cada unidade
 * (ver Gerencial > Unidade). O responsável escaneia, preenche os mesmos
 * dados que hoje o operador digitaria em EntradaScreen para uma ou mais
 * crianças (irmãos), escolhe o plano e aceita os Termos de Uso, tudo pelo
 * próprio celular, sem login.
 *
 * Isso só grava um PRÉ-cadastro (fa_kiosk_pre_checkins) — nenhuma pulseira
 * ou recibo sai daqui. Cada criança é confirmada separadamente pelo
 * operador no balcão (cada uma ganha sua própria pulseira); assim que
 * enviado, esta mesma aba passa a consultar o status em loop e mostra os
 * códigos assim que cada criança é confirmada — quando há só uma criança,
 * a tela troca sozinha para o painel de acompanhamento (mesmo componente
 * de `?acompanhar=`).
 *
 * Mesmo espírito de OnboardingInviteScreen/AcompanharScreen: vive num
 * branch de App.tsx que roda antes de qualquer checagem de sessão salva.
 */
export function AcessoRapidoScreen({ unitId }: { unitId: string }) {
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [children, setChildren] = useState<ChildForm[]>([emptyChild()]);
  const [guardianName, setGuardianName] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [preCheckinId, setPreCheckinId] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    status: "PENDENTE" | "CONVERTIDO" | "CANCELADO";
    totalChildren: number;
    sessions: Array<{ childIndex: number; childName: string; accessCode: string }>;
  } | null>(null);

  const [zoeOffers, setZoeOffers] = useState<MobileOffer[]>([]);

  useEffect(() => {
    Api.preCheckinFormOptions(unitId)
      .then(setOptions)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Não foi possível carregar o formulário."));
  }, [unitId]);

  useEffect(() => {
    if (!options) return;
    const selPlan = options.plans.find((p) => p.id === planId);
    generateMobileAcessoRapidoSuggestions({
      childrenCount: children.length,
      selectedPlanName: selPlan?.name,
      selectedPlanMinutes: selPlan ? planDurationMinutes(selPlan) : 30,
      unitName: options.unitName,
      availablePlans: options.plans.map((p) => ({
        name: p.name,
        minutes: planDurationMinutes(p),
        valueCents: p.valueCents,
      })),
    }).then(setZoeOffers);
  }, [options, planId, children.length]);

  // Enquanto aguarda o balcão confirmar: consulta pontual pelo `id`
  // devolvido no envio (não é uma listagem — ninguém mais enxerga este
  // pré-cadastro por aqui). Com 1 criança só e já convertida, troca a
  // própria URL para ?acompanhar=<accessCode> e vira AcompanharScreen; com
  // mais de uma criança, mostra os códigos aqui mesmo conforme cada uma é
  // confirmada no balcão.
  useEffect(() => {
    if (!preCheckinId || status?.status === "CANCELADO") return;
    let cancelledEffect = false;
    async function poll() {
      try {
        const res = await Api.preCheckinStatus(preCheckinId!);
        if (cancelledEffect) return;
        setStatus(res);
        if (res.status === "CONVERTIDO" && res.totalChildren === 1 && res.sessions[0]) {
          const url = new URL(window.location.href);
          url.searchParams.delete("acesso-rapido");
          url.searchParams.set("acompanhar", res.sessions[0].accessCode);
          window.history.replaceState(null, "", url.toString());
        }
      } catch {
        // Falha pontual de rede não deve travar a espera — tenta de novo no próximo poll.
      }
    }
    poll();
    const interval = setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelledEffect = true;
      clearInterval(interval);
    };
  }, [preCheckinId, status?.status]);

  function updateChild(index: number, patch: Partial<ChildForm>) {
    setChildren((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addChild() {
    setChildren((prev) => (prev.length >= MAX_CHILDREN ? prev : [...prev, emptyChild()]));
  }

  function removeChild(index: number) {
    setChildren((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function toggleSensoryTag(index: number, tag: string) {
    setChildren((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, sensoryTags: c.sensoryTags.includes(tag) ? c.sensoryTags.filter((t) => t !== tag) : [...c.sensoryTags, tag] } : c,
      ),
    );
  }

  const phoneDigits = phone.replace(/\D/g, "");
  const phoneLooksComplete = phoneDigits.length === 10 || phoneDigits.length === 11;
  const firstIncompleteChildIndex = children.findIndex((c) => !c.childName.trim() || !c.birthDate);
  const readiness = !options
    ? "Carregando…"
    : firstIncompleteChildIndex !== -1
      ? `Preencha nome e nascimento da criança ${firstIncompleteChildIndex + 1}`
      : !guardianName.trim()
        ? "Informe o nome do responsável"
        : !isValidCpf(cpf)
          ? "Informe um CPF válido do responsável"
          : !isValidPhoneBr(phone)
            ? "Informe um WhatsApp válido do responsável"
            : !planId
              ? "Escolha o plano"
              : !termsAccepted
                ? "É preciso ler e aceitar os Termos de Uso"
                : null;

  async function submit() {
    if (!options || readiness) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await Api.preCheckinSubmit({
        unitId,
        activity: options.activity,
        planId: planId!,
        children: children.map((c) => ({
          childName: c.childName.trim(),
          birthDate: c.birthDate,
          inclusiveEligible: c.isNeurodivergent,
          sensoryTags: c.sensoryTags,
          notes: c.customNotes.trim() || undefined,
        })),
        guardianName: guardianName.trim(),
        cpf: normalizeCpf(cpf),
        phoneE164: normalizePhoneE164(phone),
        termsAccepted,
      });
      setPreCheckinId(res.id);
      setPin(res.pin);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Não foi possível enviar o pré-cadastro.");
    } finally {
      setSubmitting(false);
    }
  }

  // Já convertido pelo balcão (uma criança só): vira o mesmo painel de
  // acompanhamento do QR da pulseira/recibo — sem escanear nada de novo.
  const singleChildAccessCode = status?.totalChildren === 1 ? status.sessions[0]?.accessCode : undefined;
  if (singleChildAccessCode) return <AcompanharScreen code={singleChildAccessCode} />;

  const cancelled = status?.status === "CANCELADO";

  // Melhor custo-benefício: menor valor por minuto de brincadeira — em vez
  // de âncora artificial, mostra de verdade qual plano rende mais por real
  // pago. Com 1 plano só não tem o que comparar.
  const bestValuePlanId =
    options && options.plans.length >= 2
      ? [...options.plans].sort((a, b) => a.valueCents / planDurationMinutes(a) - b.valueCents / planDurationMinutes(b))[0]!.id
      : null;

  // Mesma regra já aplicada de verdade no balcão (EntradaScreen: cupom
  // "40% PROMOCIONAL" padrão, "50% MEIA - Inclusivo" quando alguma criança
  // é neurodivergente) — só existe fora do Playground se a unidade também
  // tiver essa promoção configurada, então aqui só antecipamos a mesma
  // conta pra família já ver o valor com desconto antes de chegar.
  const anyNeurodivergent = children.some((c) => c.isNeurodivergent);
  const discountPct = options?.activity === "PLAYGROUND" ? (anyNeurodivergent ? 50 : 40) : 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #EDFBF8 0%, #FFFFFF 40%)",
        padding: "24px 16px 48px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "20px",
      }}
    >
      <BrandLockup />

      <div style={{ width: "100%", maxWidth: "480px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "24px" }}>Bora começar a diversão? 🎈</h1>
          <HelpText>
            {options
              ? `${options.unitName} — 1 minutinho e já garante o lugar de vocês, sem fila.`
              : "Só um segundinho…"}
          </HelpText>
        </div>

        {loadError && (
          <Card style={{ padding: "16px" }}>
            <p style={{ margin: 0, color: "var(--color-error-text)" }}>{loadError}</p>
          </Card>
        )}

        {preCheckinId && !cancelled && (
          <Card style={{ padding: "24px 20px", textAlign: "center", border: "2px solid var(--color-teal)" }}>
            <strong style={{ display: "block", fontSize: "18px", marginBottom: "4px" }}>
              Prontinho! 🎉 Já estamos te esperando
            </strong>
            <p style={{ margin: "0 0 18px", fontSize: "14px", color: "var(--text-muted)" }}>
              Dirija-se ao balcão — é só falar o código abaixo para a equipe já saber quem é vocês.
            </p>
            {pin && (
              <div
                style={{
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "4px",
                  padding: "14px 28px",
                  borderRadius: "18px",
                  background: "rgba(46, 207, 181, 0.08)",
                  border: "2px dashed var(--color-teal)",
                  marginBottom: "18px",
                }}
              >
                <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Seu código
                </span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: "40px", letterSpacing: "0.12em", color: "var(--color-teal-text)", lineHeight: 1 }}>
                  {pin}
                </span>
              </div>
            )}
            {status && status.totalChildren > 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px", textAlign: "left" }}>
                {children.map((c, i) => {
                  const session = status.sessions.find((s) => s.childIndex === i);
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        borderRadius: "10px",
                        background: session ? "rgba(46, 207, 181, 0.08)" : "var(--surface-sunken)",
                        fontSize: "13px",
                      }}
                    >
                      <span>{c.childName || `Criança ${i + 1}`}</span>
                      <span style={{ fontWeight: 700, color: session ? "var(--color-teal-text)" : "var(--text-muted)" }}>
                        {session ? "✓ Confirmada" : "Aguardando balcão"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>
              E o melhor: assim que a equipe confirmar a entrada, esta mesma tela já mostra quem já foi chamado —
              não precisa escanear mais nada. 💛
            </p>
          </Card>
        )}

        {cancelled && (
          <Card style={{ padding: "16px" }}>
            <p style={{ margin: 0 }}>
              Este pré-cadastro foi cancelado pela equipe do balcão. Se ainda quiser entrar, procure a recepção.
            </p>
          </Card>
        )}

        {options && !preCheckinId && (
          <>
            <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong style={{ fontSize: "15px" }}>1. Quem vem brincar? 🧒</strong>
                {children.length > 1 && (
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{children.length} crianças</span>
                )}
              </div>

              {children.map((child, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    padding: children.length > 1 ? "12px" : 0,
                    borderRadius: "12px",
                    background: children.length > 1 ? "var(--surface-sunken)" : "transparent",
                  }}
                >
                  {children.length > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-muted)" }}>Criança {index + 1}</span>
                      <Button variant="ghost" size="sm" type="button" onClick={() => removeChild(index)}>
                        ✕ Remover
                      </Button>
                    </div>
                  )}
                  <Input
                    label="Nome da criança"
                    placeholder="Nome completo"
                    value={child.childName}
                    onChange={(e) => updateChild(index, { childName: e.target.value })}
                  />
                  <DateInput
                    label="Data de nascimento"
                    value={child.birthDate}
                    onChange={(value) => updateChild(index, { birthDate: value })}
                  />
                  <Checkbox
                    label="Criança neurodivergente"
                    helpText="Marque para registrar cuidados sensoriais — a equipe já chega sabendo."
                    checked={child.isNeurodivergent}
                    onChange={(checked) => {
                      updateChild(index, {
                        isNeurodivergent: checked,
                        sensoryTags: checked ? child.sensoryTags : [],
                        customNotes: checked ? child.customNotes : "",
                      });
                    }}
                  />
                  {child.isNeurodivergent && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {SENSORY_TAG_OPTIONS.map((tag) => {
                          const isSelected = child.sensoryTags.includes(tag);
                          return (
                            <Button
                              key={tag}
                              type="button"
                              variant={isSelected ? "teal" : "ghost"}
                              size="sm"
                              onClick={() => toggleSensoryTag(index, tag)}
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
                        value={child.customNotes}
                        onChange={(e) => updateChild(index, { customNotes: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              ))}

              {children.length < MAX_CHILDREN && (
                <Button variant="ghost" type="button" onClick={addChild} style={{ alignSelf: "flex-start", borderRadius: "9999px" }}>
                  + Adicionar outra criança
                </Button>
              )}
            </Card>

            <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <strong style={{ fontSize: "15px" }}>2. E o responsável, quem é? 👋</strong>
              <Input label="Nome do responsável" placeholder="Pai, mãe ou acompanhante" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
              <Input label="CPF" placeholder="000.000.000-00" inputMode="numeric" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} />
              {cpf.length === 14 && !isValidCpf(cpf) && (
                <Tag role="alert" color="var(--color-error)">CPF inválido</Tag>
              )}
              <Input
                label="WhatsApp"
                placeholder="(91) 98250-1215"
                inputMode="numeric"
                maxLength={15}
                value={phone}
                onChange={(e) => setPhone(formatPhoneBr(e.target.value))}
              />
              {phoneLooksComplete && !isValidPhoneBr(phone) && (
                <Tag role="alert" color="var(--color-error)">WhatsApp inválido — DDD + número, com o 9 do celular</Tag>
              )}
            </Card>

            <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <strong style={{ fontSize: "15px" }}>3. Qual plano combina mais? ⏰</strong>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {options.plans.map((plan) => {
                  const isSelected = planId === plan.id;
                  const isBestValue = plan.id === bestValuePlanId;
                  const discountedCents = discountPct > 0 ? Math.round((plan.valueCents * (100 - discountPct)) / 100) : plan.valueCents;
                  return (
                    <Card
                      key={plan.id}
                      onClick={() => setPlanId(plan.id)}
                      style={{
                        cursor: "pointer",
                        position: "relative",
                        padding: "18px 16px 14px",
                        marginTop: isBestValue && !isSelected ? "12px" : 0,
                        minWidth: "150px",
                        borderRadius: "14px",
                        transition: "border-color 150ms ease, background 150ms ease, transform 150ms ease",
                        border: isSelected
                          ? "2px solid var(--color-teal)"
                          : isBestValue
                            ? "2px solid var(--color-teal)"
                            : "1px solid var(--border-subtle)",
                        background: isSelected ? "rgba(46, 207, 181, 0.08)" : "var(--surface-card)",
                        transform: isSelected ? "scale(1.02)" : "scale(1)",
                      }}
                    >
                      {isBestValue && (
                        <span
                          style={{
                            position: "absolute",
                            top: "-13px",
                            left: "12px",
                            right: "12px",
                            fontSize: "10px",
                            fontWeight: 800,
                            letterSpacing: "0.02em",
                            color: "#fff",
                            background: "var(--color-teal)",
                            borderRadius: "9999px",
                            padding: "3px 10px",
                            textAlign: "center",
                            whiteSpace: "nowrap",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                          }}
                        >
                          🏆 Melhor custo-benefício
                        </span>
                      )}
                      <strong style={{ fontSize: "15px", display: "block" }}>{plan.name}</strong>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{planDurationMinutes(plan)} min de diversão</span>
                      {discountPct > 0 ? (
                        <div style={{ marginTop: "4px" }}>
                          <span style={{ fontSize: "12px", color: "var(--text-muted)", textDecoration: "line-through" }}>
                            {money(plan.valueCents)}
                          </span>
                          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                            <span style={{ fontSize: "18px", color: "var(--color-teal-text)", fontWeight: "bold" }}>
                              {money(discountedCents)}
                            </span>
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 800,
                                color: "#fff",
                                background: "var(--color-teal)",
                                borderRadius: "6px",
                                padding: "1px 6px",
                              }}
                            >
                              -{discountPct}%
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: "17px", color: "var(--color-teal-text)", fontWeight: "bold", marginTop: "4px" }}>
                          {money(plan.valueCents)}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
              {discountPct > 0 && (
                <HelpText>
                  {anyNeurodivergent
                    ? "✓ Desconto de 50% MEIA - Inclusivo aplicado automaticamente."
                    : "✓ Desconto de 40% PROMOCIONAL aplicado automaticamente."}
                </HelpText>
              )}
            </Card>

            {/* Recomendações de Venda Cruzada e Custo-Benefício da ZoeIA */}
            {zoeOffers.length > 0 && (
              <Card
                style={{
                  padding: "16px",
                  background: "linear-gradient(135deg, #f5f3ff 0%, #eff6ff 100%)",
                  border: "1.5px solid #c084fc",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Tag style={{ background: "#7c3aed", color: "#ffffff", fontWeight: "bold" }}>✦ ZoeIA</Tag>
                  <strong style={{ fontSize: "14px", color: "#5b21b6" }}>Dica & Vantagens Exclusivas</strong>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {zoeOffers.map((offer) => (
                    <div
                      key={offer.id}
                      style={{
                        padding: "12px",
                        background: "#ffffff",
                        borderRadius: "12px",
                        border: "1px solid #e9d5ff",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <strong style={{ fontSize: "13px", color: "#4c1d95" }}>{offer.title}</strong>
                        {offer.badge && (
                          <span style={{ fontSize: "11px", fontWeight: "bold", color: "#7c3aed", background: "#f3e8ff", padding: "2px 8px", borderRadius: "9999px" }}>
                            {offer.badge}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: "12px", color: "#6b21a8", lineHeight: 1.4 }}>
                        {offer.description}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <strong style={{ fontSize: "15px" }}>4. Só combinar as regrinhas ✅</strong>
              {termsAccepted ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                  <Tag color="var(--color-teal)">✓ Termos lidos e aceitos</Tag>
                  <Button variant="ghost" size="sm" type="button" onClick={() => setTermsModalOpen(true)}>
                    Ler novamente
                  </Button>
                </div>
              ) : (
                <>
                  <HelpText>Toque para ler os Termos de Uso do Playground antes de continuar.</HelpText>
                  <Button
                    variant="teal"
                    type="button"
                    onClick={() => setTermsModalOpen(true)}
                    disabled={!options.termsText}
                    style={{ borderRadius: "9999px" }}
                  >
                    📄 Ler os Termos de Uso
                  </Button>
                  {!options.termsText && <HelpText>Termos de Uso ainda não configurados por esta unidade.</HelpText>}
                </>
              )}
            </Card>

            {termsModalOpen && (
              <Modal title="Termos de Uso — Faça Amigos" onClose={() => setTermsModalOpen(false)} maxWidth="560px">
                <div
                  style={{
                    maxHeight: "50vh",
                    overflowY: "auto",
                    fontSize: "13px",
                    lineHeight: 1.6,
                    color: "var(--text-secondary)",
                    background: "var(--surface-sunken)",
                    borderRadius: "10px",
                    padding: "12px 14px",
                    whiteSpace: "pre-wrap",
                    marginBottom: "16px",
                  }}
                >
                  {options.termsText}
                </div>
                <Button
                  variant="teal"
                  size="lg"
                  type="button"
                  onClick={() => {
                    setTermsAccepted(true);
                    setTermsModalOpen(false);
                  }}
                  style={{ width: "100%", borderRadius: "9999px" }}
                >
                  Estou ciente e aceito
                </Button>
              </Modal>
            )}

            {submitError && (
              <p role="alert" style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{submitError}</p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {readiness && <span style={{ fontSize: "13px", color: "var(--text-muted)", textAlign: "center" }}>{readiness}</span>}
              <Button
                variant="teal"
                size="lg"
                loading={submitting}
                disabled={submitting || Boolean(readiness)}
                onClick={submit}
                style={{ borderRadius: "9999px", padding: "16px" }}
              >
                🎈 Garantir o lugar agora
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
