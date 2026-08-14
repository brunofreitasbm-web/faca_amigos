import { useEffect, useState } from "react";
import { Button, Card, Checkbox, DateInput, Input, HelpText, Tag, BrandLockup } from "@facaamigos/ui";
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

const STATUS_POLL_MS = 5000;

/**
 * QR Code de Acesso Rápido — cartaz fixo na entrada de cada unidade
 * (ver Gerencial > Unidade). O responsável escaneia, preenche os mesmos
 * dados que hoje o operador digitaria em EntradaScreen, escolhe o plano e
 * aceita os Termos de Uso, tudo pelo próprio celular, sem login.
 *
 * Isso só grava um PRÉ-cadastro (fa_kiosk_pre_checkins) — nenhuma pulseira
 * ou recibo sai daqui. Assim que enviado, esta mesma aba passa a consultar
 * o status em loop; quando o operador confirma a entrada de verdade no
 * balcão (EntradaScreen já vem preenchida a partir do pré-cadastro), a
 * página troca sozinha para o painel de acompanhamento (mesmo componente
 * de `?acompanhar=`) — o responsável nunca precisa escanear o QR da
 * pulseira/recibo à parte.
 *
 * Mesmo espírito de OnboardingInviteScreen/AcompanharScreen: vive num
 * branch de App.tsx que roda antes de qualquer checagem de sessão salva.
 */
export function AcessoRapidoScreen({ unitId }: { unitId: string }) {
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [childName, setChildName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
  const [isNeurodivergent, setIsNeurodivergent] = useState(false);
  const [selectedSensoryTags, setSelectedSensoryTags] = useState<string[]>([]);
  const [customNotes, setCustomNotes] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [preCheckinId, setPreCheckinId] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    Api.preCheckinFormOptions(unitId)
      .then(setOptions)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Não foi possível carregar o formulário."));
  }, [unitId]);

  // Enquanto aguarda o balcão confirmar: consulta pontual pelo `id`
  // devolvido no envio (não é uma listagem — ninguém mais enxerga este
  // pré-cadastro por aqui). Ao converter, troca a própria URL para
  // ?acompanhar=<accessCode> e some — o resto da tela vira AcompanharScreen.
  useEffect(() => {
    if (!preCheckinId || accessCode) return;
    let cancelledEffect = false;
    async function poll() {
      try {
        const res = await Api.preCheckinStatus(preCheckinId!);
        if (cancelledEffect) return;
        if (res.status === "CONVERTIDO" && res.accessCode) {
          const url = new URL(window.location.href);
          url.searchParams.delete("acesso-rapido");
          url.searchParams.set("acompanhar", res.accessCode);
          window.history.replaceState(null, "", url.toString());
          setAccessCode(res.accessCode);
        } else if (res.status === "CANCELADO") {
          setCancelled(true);
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
  }, [preCheckinId, accessCode]);

  function toggleSensoryTag(tag: string) {
    setSelectedSensoryTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  const phoneDigits = phone.replace(/\D/g, "");
  const phoneLooksComplete = phoneDigits.length === 10 || phoneDigits.length === 11;
  const readiness = !options
    ? "Carregando…"
    : !childName.trim()
      ? "Informe o nome da criança"
      : !birthDate
        ? "Informe a data de nascimento"
        : !guardianName.trim()
          ? "Informe o nome do responsável"
          : !isValidPhoneBr(phone)
            ? "Informe um WhatsApp válido do responsável"
            : !planId
              ? "Escolha o plano"
              : !termsAccepted
                ? "É preciso aceitar os Termos de Uso"
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
        childName: childName.trim(),
        birthDate,
        guardianName: guardianName.trim(),
        cpf: cpf ? normalizeCpf(cpf) : undefined,
        phoneE164: normalizePhoneE164(phone),
        termsAccepted,
        inclusiveEligible: isNeurodivergent,
        sensoryTags: selectedSensoryTags,
        notes: customNotes.trim() || undefined,
      });
      setPreCheckinId(res.id);
      setPin(res.pin);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Não foi possível enviar o pré-cadastro.");
    } finally {
      setSubmitting(false);
    }
  }

  // Já convertido pelo balcão: vira o mesmo painel de acompanhamento do QR
  // da pulseira/recibo — sem escanear nada de novo.
  if (accessCode) return <AcompanharScreen code={accessCode} />;

  // Selo "Mais escolhido": efeito de ancoragem sutil clássico de pricing
  // table — em vez de destacar o mais caro (empurrão óbvio) ou o mais
  // barato (âncora pra baixo), destaca o segundo mais longo. Com 1 plano
  // só não tem o que ancorar; com 2+ o card guia o olhar sem esconder as
  // outras opções nem embutir desconto real algum.
  const plansByDuration = options ? [...options.plans].sort((a, b) => planDurationMinutes(a) - planDurationMinutes(b)) : [];
  const recommendedPlanId = plansByDuration.length >= 2 ? (plansByDuration[plansByDuration.length - 2]?.id ?? null) : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #FFF7FA 0%, #FFFFFF 40%)",
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
                  background: "rgba(240, 25, 107, 0.06)",
                  border: "2px dashed var(--color-primary)",
                  marginBottom: "18px",
                }}
              >
                <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Seu código
                </span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: "40px", letterSpacing: "0.12em", color: "var(--color-primary-hover)", lineHeight: 1 }}>
                  {pin}
                </span>
              </div>
            )}
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>
              E o melhor: assim que a equipe confirmar a entrada de {childName.split(" ")[0] || "sua criança"}, esta
              mesma tela já vira o acompanhamento em tempo real — não precisa escanear mais nada. 💛
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
            <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <strong style={{ fontSize: "15px" }}>1. Quem vem brincar? 🧒</strong>
              <Input label="Nome da criança" placeholder="Nome completo" value={childName} onChange={(e) => setChildName(e.target.value)} />
              <DateInput label="Data de nascimento" value={birthDate} onChange={setBirthDate} />
            </Card>

            <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <strong style={{ fontSize: "15px" }}>2. E o responsável, quem é? 👋</strong>
              <Input label="Nome do responsável" placeholder="Pai, mãe ou acompanhante" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
              <Input label="CPF (opcional)" placeholder="000.000.000-00" inputMode="numeric" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} />
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

            <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <Checkbox
                label="Criança neurodivergente"
                helpText="Marque para registrar cuidados sensoriais — a equipe já chega sabendo."
                checked={isNeurodivergent}
                onChange={(checked) => {
                  setIsNeurodivergent(checked);
                  if (!checked) {
                    setSelectedSensoryTags([]);
                    setCustomNotes("");
                  }
                }}
              />
              {isNeurodivergent && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
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
            </Card>

            <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <strong style={{ fontSize: "15px" }}>3. Qual plano combina mais? ⏰</strong>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {options.plans.map((plan) => {
                  const isSelected = planId === plan.id;
                  const isRecommended = plan.id === recommendedPlanId;
                  return (
                    <Card
                      key={plan.id}
                      onClick={() => setPlanId(plan.id)}
                      style={{
                        cursor: "pointer",
                        position: "relative",
                        padding: "12px 16px",
                        minWidth: "130px",
                        borderRadius: "14px",
                        transition: "border-color 150ms ease, background 150ms ease, transform 150ms ease",
                        border: isSelected
                          ? "2px solid var(--color-primary)"
                          : isRecommended
                            ? "2px solid var(--color-teal)"
                            : "1px solid var(--border-subtle)",
                        background: isSelected ? "rgba(240, 25, 107, 0.06)" : "var(--surface-card)",
                        transform: isSelected ? "scale(1.02)" : "scale(1)",
                      }}
                    >
                      {isRecommended && !isSelected && (
                        <span
                          style={{
                            position: "absolute",
                            top: "-10px",
                            left: "12px",
                            fontSize: "10px",
                            fontWeight: 800,
                            letterSpacing: "0.02em",
                            color: "#fff",
                            background: "var(--color-teal)",
                            borderRadius: "9999px",
                            padding: "2px 8px",
                          }}
                        >
                          🌟 Mais escolhido
                        </span>
                      )}
                      <strong style={{ fontSize: "15px", display: "block" }}>{plan.name}</strong>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{planDurationMinutes(plan)} min de diversão</span>
                      <div style={{ fontSize: "17px", color: "var(--color-primary-hover)", fontWeight: "bold" }}>
                        {money(plan.valueCents)}
                      </div>
                    </Card>
                  );
                })}
              </div>
              {options.plans.length === 0 && <HelpText>Nenhum plano ativo nesta unidade no momento — procure a recepção.</HelpText>}
            </Card>

            <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <strong style={{ fontSize: "15px" }}>4. Só combinar as regrinhas ✅</strong>
              {options.termsText ? (
                <div
                  style={{
                    maxHeight: "180px",
                    overflowY: "auto",
                    fontSize: "13px",
                    lineHeight: 1.5,
                    color: "var(--text-secondary)",
                    background: "var(--surface-sunken)",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {options.termsText}
                </div>
              ) : (
                <HelpText>Termos de Uso ainda não configurados por esta unidade.</HelpText>
              )}
              <Checkbox
                label="Li e aceito os Termos de Uso"
                checked={termsAccepted}
                onChange={setTermsAccepted}
              />
            </Card>

            {submitError && (
              <p role="alert" style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{submitError}</p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {readiness && <span style={{ fontSize: "13px", color: "var(--text-muted)", textAlign: "center" }}>{readiness}</span>}
              <Button
                variant="primary"
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
