import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Checkbox, Input, Select, DateInput, Tag, Badge, HelpText, Modal, StatusBadge } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Asset, ChildMatch, Coupon, Package, Plan, Product, UpsellOffer } from "../api/client.js";
import { UpsellOfferCard } from "../components/UpsellOfferCard.js";
import { GeminiSalesCard } from "../components/GeminiSalesCard.js";
import { generateCheckinSuggestions, type CheckinOffer } from "../lib/geminiAgent.js";
import { PhotoCapture } from "../components/PhotoCapture.js";
import { ContractModal } from "../components/ContractModal.js";
import { WristbandQRCode } from "../components/WristbandQRCode.js";
import { formatPlanoHoras } from "../contract/contractTemplate.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { useAcompanhar } from "../api/useAcompanhar.js";
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
import { money, formatElapsed } from "../format.js";

// Lista padrão e assertiva — o operador marca em vez de descrever do zero
// na hora do balcão, com a família esperando. Os cinco primeiros itens são
// os originais do fluxo (não renomear: o texto é gravado por visita e
// prefila o cadastro seguinte da mesma criança); os demais foram
// adicionados para cobrir os quadros sensoriais mais comuns fora desses.
export const SENSORY_TAG_OPTIONS = [
  "Sensível a Ruído Alto",
  "Usa Abafador",
  "Acompanhante / Mediador 1:1",
  "Preferência pelo Cantinho da Calma",
  "Alergia Alimentar / Cuidados Especializados",
  "Aversão a Texturas / Toque",
  "Sensibilidade à Luz ou Estímulos Visuais",
  "Dificuldade com Mudança de Rotina",
  "Comunicação Não-verbal / Uso de Figuras (CAA)",
  "Evita Contato Físico Inesperado",
  "Necessidade de Pausas Sensoriais Frequentes",
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
function getPlanDiscountedCents(
  valueCents: number,
  code: string,
  couponsList: Coupon[],
  planId?: string | null,
): { finalCents: number; originalCents: number; discountText: string | null } {
  if (!code) return { finalCents: valueCents, originalCents: valueCents, discountText: null };

  const couponObj = couponsList.find((c) => c.code.toLowerCase() === code.toLowerCase());
  if (couponObj?.allowedPlanId && couponObj.allowedPlanId !== planId) {
    return { finalCents: valueCents, originalCents: valueCents, discountText: null };
  }
  let discountPct: number | null = null;
  let discountCents: number | null = null;

  if (couponObj) {
    if (couponObj.kind === "DESCONTO_PCT") discountPct = couponObj.value;
    else if (couponObj.kind === "DESCONTO_VALOR") discountCents = couponObj.value;
  }

  if (discountPct === null && discountCents === null) {
    if (code.includes("50%")) discountPct = 50;
    else if (code.includes("40%")) discountPct = 40;
  }

  let finalCents = valueCents;
  let discountText: string | null = null;

  if (discountPct !== null && discountPct > 0) {
    const cut = Math.round((valueCents * discountPct) / 100);
    finalCents = Math.max(0, valueCents - cut);
    discountText = `-${discountPct}%`;
  } else if (discountCents !== null && discountCents > 0) {
    finalCents = Math.max(0, valueCents - discountCents);
    discountText = `-${money(discountCents)}`;
  }

  return { finalCents, originalCents: valueCents, discountText };
}

export type PreCheckinPrefill = Awaited<ReturnType<typeof Api.preCheckinList>>[number];

export function EntradaScreen({
  onSuccess,
  prefill,
  onPrefillConsumed,
}: {
  onSuccess?: () => void;
  /** Pré-cadastro feito pelo responsável no QR de Acesso Rápido (ver PainelScreen) — preenche o formulário para o operador só conferir e confirmar. */
  prefill?: PreCheckinPrefill | null;
  /** Avisa quem abriu a tela (PainelScreen) que o prefill já foi consumido, para fechar o card da lista de pendentes. */
  onPrefillConsumed?: () => void;
} = {}) {
  const { unit, employee } = useAppState();
  const toast = useToast();
  const activity = unit?.kind === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [preCheckinId, setPreCheckinId] = useState<string | null>(null);
  const [preCheckinChildIndex, setPreCheckinChildIndex] = useState<number | null>(null);

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

  const [isNeurodivergent, setIsNeurodivergent] = useState(false);
  const [selectedSensoryTags, setSelectedSensoryTags] = useState<string[]>([]);
  const [customNotes, setCustomNotes] = useState("");
  const [childPhoto, setChildPhoto] = useState<Blob | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [showExtras, setShowExtras] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    sessionId: string;
    accessCode: string;
    exitPin: string;
    childName: string;
    guardianId: string;
    /** Plano vendido acima de 2h — habilita o botão de imprimir o contrato. */
    contractPlan: { name: string; valueCents: number; minutes: number } | null;
  } | null>(null);
  const [contractOpen, setContractOpen] = useState(false);
  const [acompanharOpen, setAcompanharOpen] = useState(false);

  // Mesmo endereço público (Vercel) já usado no pareamento de celular/tablet
  // em ConnectDeviceModal — no Electron local, window.location.origin é
  // 127.0.0.1, que o celular do responsável não alcança.
  const envAppUrl = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  const isLocalOrigin = ["127.0.0.1", "localhost"].includes(window.location.hostname);
  const publicAppOrigin = envAppUrl ?? (isLocalOrigin ? undefined : window.location.origin);
  const acompanharUrl =
    done && publicAppOrigin ? `${publicAppOrigin.replace(/\/$/, "")}/?acompanhar=${done.accessCode}` : null;

  // Mesmo hook do painel do responsável (AcompanharScreen): busca a sessão
  // pela mesma RPC anônima e recalcula o cronômetro a 1Hz localmente. Ao
  // reusar o hook em vez de duplicar a lógica, o tempo mostrado aqui no
  // balcão nunca diverge do que aparece no celular de quem escaneou o QR.
  const { timing: acompanharTiming } = useAcompanhar(acompanharOpen && done ? done.accessCode : null);

  // Saldo do banco de horas da criança identificada (planos >2h de visitas
  // anteriores, em qualquer unidade). null = sem saldo ou não consultado.
  const [hourBank, setHourBank] = useState<{ remainingMinutes: number; nextExpiryMs: number } | null>(null);

  // Oferta de upgrade da criança identificada. `null` cobre os dois casos
  // em que não há card: ainda não consultado e não elegível — a tela trata
  // os dois igual, então não vale um estado a mais para distingui-los.
  const [offer, setOffer] = useState<UpsellOffer | null>(null);

  // Cross-sell rápido (produto único, ex.: "Água") — parametrizável em
  // Configurações. Diferente da oferta de upgrade acima: não tem script
  // nem ancoragem, é só "oferecer X por R$Y" quando o plano escolhido é
  // longo o bastante para fazer sentido (padrão: 60 min).
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const [quickTriggerMinutes, setQuickTriggerMinutes] = useState(60);
  const [quickUpsellAccepted, setQuickUpsellAccepted] = useState(false);
  const [crossSellModalOpen, setCrossSellModalOpen] = useState(false);

  const [lastGuardianId, setLastGuardianId] = useState<string | null>(null);
  const [closingTime, setClosingTime] = useState<string | undefined>(undefined);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [geminiOffers, setGeminiOffers] = useState<CheckinOffer[]>([]);
  const [loadingGemini, setLoadingGemini] = useState(false);

  useEffect(() => {
    if (!unit) return;
    Api.unitSetting(unit.id, "closing_time")
      .then((r) => setClosingTime(r.value ?? undefined))
      .catch(() => {});
  }, [unit]);

  // Configuração do cross-sell rápido: qual produto oferecer e a partir de
  // quantos minutos de plano. Se não houver id configurado, tenta localizar "Água".
  useEffect(() => {
    if (!unit) return;
    Api.unitSetting(unit.id, "upsell_quick_trigger_minutes")
      .then((r) => setQuickTriggerMinutes(r.value ? Number(r.value) : 60))
      .catch(() => {});
    Api.unitSetting(unit.id, "upsell_quick_product_id")
      .then((r) => {
        return Api.products(unit.id).then((products) => {
          if (r.value) {
            const found = products.find((p) => p.id === r.value);
            if (found) return setQuickProduct(found);
          }
          const agua = products.find((p) => p.name.toLowerCase().includes("água") || p.name.toLowerCase().includes("agua"));
          if (agua) return setQuickProduct(agua);
          const fallback = products[0];
          if (fallback) return setQuickProduct(fallback);
          setQuickProduct(null);
        });
      })
      .catch(() => setQuickProduct(null));
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
    Api.packages(unit.id, activity).then(setPackages);
    Api.products(unit.id).then(setProducts);
    Api.coupons(unit.id).then(setCoupons);
    if (activity === "CARRINHO") Api.assets(unit.id).then(setAssets);
  }, [unit, activity]);

  // Pré-cadastro do QR de Acesso Rápido: preenche o formulário exatamente
  // como se o operador tivesse digitado tudo — ele só confere identidade
  // e toca em "Confirmar entrada". `submit()` manda o `preCheckinId`
  // junto no fa_checkin, que marca a origem como CONVERTIDO na mesma
  // transação (ver client.ts `checkin`).
  useEffect(() => {
    if (!prefill) return;
    setPreCheckinId(prefill.id);
    setPreCheckinChildIndex(prefill.childIndex);
    setMatchedChild(null);
    setMatches([]);
    setShowNewForm(true);
    setChildName(prefill.childName);
    setBirthDate(prefill.birthDate);
    setGuardianName(prefill.guardianName);
    setCpf(prefill.cpf ? formatCpf(prefill.cpf) : "");
    setPhone(formatPhoneBr(prefill.phoneE164));
    setPlanId(prefill.packageId ? `${PACKAGE_PREFIX}${prefill.packageId}` : prefill.planId);
    setIsNeurodivergent(prefill.inclusiveEligible || (prefill.sensoryTags?.length ?? 0) > 0);
    setSelectedSensoryTags(prefill.sensoryTags ?? []);
    setCustomNotes(prefill.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.id]);

  // Aplicação automática de cupons no Playground:
  // - Criança neurodivergente marcada -> "50% MEIA - Inclusivo"
  // - Não marcada -> "40% PROMOCIONAL" em todos os planos
  useEffect(() => {
    if (activity !== "PLAYGROUND") return;

    if (isNeurodivergent) {
      const match50 = coupons.find(
        (c) =>
          c.active !== false &&
          (c.code.toLowerCase().includes("50%") ||
            c.code.toLowerCase().includes("inclusivo") ||
            c.code.toLowerCase().includes("meia") ||
            c.description?.toLowerCase().includes("inclusivo")),
      );
      setCouponCode(match50 ? match50.code : "50% MEIA - Inclusivo");
    } else {
      const match40 = coupons.find(
        (c) =>
          c.active !== false &&
          (c.code.toLowerCase().includes("40%") ||
            c.code.toLowerCase().includes("promocional") ||
            c.description?.toLowerCase().includes("promocional")),
      );
      setCouponCode(match40 ? match40.code : "40% PROMOCIONAL");
    }
  }, [activity, isNeurodivergent, coupons]);

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
    setHourBank(null);

    // Saldo do banco de horas (planos >2h de visitas anteriores, em
    // qualquer unidade): consultado aqui para a opção "Usar banco de
    // horas" já aparecer junto dos planos, antes de vender um novo.
    Api.hourBankBalances([match.id])
      .then((map) => {
        const b = map.get(match.id);
        setHourBank(b && b.remaining_minutes > 0 ? { remainingMinutes: b.remaining_minutes, nextExpiryMs: b.next_expiry_ms } : null);
      })
      .catch(() => setHourBank(null));

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
        if (care.sensoryTags.length > 0 || care.notes) setIsNeurodivergent(true);
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

  // Próxima criança do MESMO responsável (irmão/irmã). Os dados do
  // responsável já ficam preservados pelo resetForNextChild(true) após o
  // check-in — este atalho só abre o cadastro direto, com eles prefilados,
  // em vez de deixar o operador descobrir isso sozinho pela dica de texto.
  // Pode ser tocado quantas vezes forem as crianças da família.
  function addSiblingChild() {
    setQuery("");
    setChildName("");
    setBirthDate("");
    setIsNeurodivergent(false);
    setSelectedSensoryTags([]);
    setCustomNotes("");
    setChildPhoto(null);
    setShowNewForm(true);
    setMatchedChild(null);
    setMatches([]);
    setOffer(null);
    setPreCheckinId(null);
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
    setHourBank(null);
    setChildName("");
    setBirthDate("");
    setIsNeurodivergent(false);
    setSelectedSensoryTags([]);
    setCustomNotes("");
    setChildPhoto(null);
    setPlanId(null);
    setCouponCode("");
    setShowExtras(false);
    setFavoriteAssetId(null);
    setQuickUpsellAccepted(false);
    setPreCheckinId(null);
    if (!keepGuardian) {
      setCpf("");
      setGuardianName("");
      setPhone("");
      setLastGuardianId(null);
    }
    searchRef.current?.focus();
  }

  const identified = Boolean(matchedChild) || showNewForm;
  // Sentinela do "plano" Banco de Horas: reusa o fluxo de seleção/validação
  // dos planos sem virar um plano de verdade.
  const HOUR_BANK = "HOUR_BANK";
  const usingHourBank = planId === HOUR_BANK;
  // Pacotes aparecem no mesmo grid dos planos, sem distinção: cada um vira
  // um Plan sintético (id prefixado) — o resto da tela (preço, "cabe até o
  // fechamento", contrato >2h, cross-sell) já sabe lidar com um Plan
  // sintético, mesmo truque já usado para o Banco de Horas.
  const PACKAGE_PREFIX = "PKG:";
  const packagePlans: Plan[] = packages.map((pkg) => ({
    id: `${PACKAGE_PREFIX}${pkg.id}`,
    activity: pkg.activity,
    name: pkg.name,
    valueCents: pkg.priceCents,
    durationValue: pkg.includedMinutes,
    durationUnit: "MINUTO",
    overageCentsPerMinute: pkg.overageCentsPerMinute,
    color: pkg.color,
  }));
  const usingPackage = planId?.startsWith(PACKAGE_PREFIX) ?? false;
  const selectedPackageId = usingPackage ? planId!.slice(PACKAGE_PREFIX.length) : null;
  const selectedPlan = plans.find((p) => p.id === planId) ?? packagePlans.find((p) => p.id === planId);
  const threshold = 120;

  // Cupons restritos a um plano (ex.: "N ESTRELAS", só no plano de 30min)
  // só aparecem quando esse plano está selecionado — evita o operador
  // escolher um cupom que o servidor vai recusar no check-in.
  const eligibleCoupons = useMemo(
    () => coupons.filter((c) => !c.allowedPlanId || c.allowedPlanId === planId),
    [coupons, planId],
  );

  useEffect(() => {
    if (!unit) return;
    const currentName = childName.trim();
    if (!currentName && !selectedPlan) {
      setGeminiOffers([]);
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      setLoadingGemini(true);
      generateCheckinSuggestions({
        childName: currentName,
        responsibleName: guardianName,
        selectedPlanName: selectedPlan?.name,
        selectedPlanMinutes: selectedPlan ? planDurationMinutes(selectedPlan) : 30,
        selectedPlanPriceCents: selectedPlan?.valueCents,
        unitName: unit.name,
        availablePlans: plans.map((p) => ({
          id: p.id,
          name: p.name,
          valueCents: p.valueCents,
          minutes: planDurationMinutes(p),
        })),
        availableProducts: products.map((p) => ({
          id: p.id,
          name: p.name,
          priceCents: p.price_cents,
        })),
        availableCoupons: eligibleCoupons.map((c) => ({
          code: c.code,
          discountText: c.kind === "DESCONTO_PCT" ? `${c.value}% OFF` : `R$ ${(c.value / 100).toFixed(2)} OFF`,
        })),
      })
        .then((offers) => {
          if (active) setGeminiOffers(offers);
        })
        .finally(() => {
          if (active) setLoadingGemini(false);
        });
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [matchedChild?.id, childName, selectedPlan?.id, guardianName, unit?.id, plans, products, eligibleCoupons]);

  function handleApplyGeminiOffer(offer: CheckinOffer) {
    if (offer.actionType === "UPGRADE_PLAN") {
      const higherPlan = plans.find(
        (p) =>
          (offer.targetName && p.name.toLowerCase().includes(offer.targetName.toLowerCase())) ||
          planDurationMinutes(p) > (selectedPlan ? planDurationMinutes(selectedPlan) : 30),
      );
      if (higherPlan) {
        setPlanId(higherPlan.id);
        toast.success(`Plano alterado para ${higherPlan.name}!`);
      }
    } else if (offer.actionType === "APPLY_COUPON") {
      if (offer.targetName) {
        setCouponCode(offer.targetName);
        toast.success(`Cupom "${offer.targetName}" aplicado!`);
      }
    } else if (offer.actionType === "ADD_PRODUCT") {
      setShowExtras(true);
      toast.success(`Item "${offer.targetName || offer.title}" recomendado no balcão!`);
    }
  }

  useEffect(() => {
    if (couponCode && !eligibleCoupons.some((c) => c.code === couponCode)) setCouponCode("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

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
        planId: usingHourBank || usingPackage ? null : planId!,
        useHourBank: usingHourBank,
        packageId: usingPackage ? selectedPackageId : undefined,
        employeeId: employee.id,
        child: { id: matchedChild?.id, fullName: childName.trim(), birthDate, inclusiveEligible: false },
        guardian: {
          id: lastGuardianId ?? undefined,
          fullName: guardianName.trim(),
          cpf: normalizeCpf(cpf),
          phoneE164: normalizePhoneE164(phone),
        },
        couponCode: usingHourBank ? undefined : couponCode || undefined,
        notes: customNotes.trim() || undefined,
        sensoryTags: selectedSensoryTags,
        preCheckinId: preCheckinId ?? undefined,
        preCheckinChildIndex: preCheckinId ? (preCheckinChildIndex ?? undefined) : undefined,
      });

      if (preCheckinId) {
        setPreCheckinId(null);
        setPreCheckinChildIndex(null);
        onPrefillConsumed?.();
      }

      setDone({
        sessionId: res.sessionId,
        accessCode: res.accessCode,
        exitPin: res.exitPin,
        childName: childName.trim(),
        guardianId: res.guardianId,
        // Plano acima de 2h vendido agora: habilita o botão do contrato de
        // prestação de serviços (banco de horas garantido em contrato).
        contractPlan:
          selectedPlan && planDurationMinutes(selectedPlan) > threshold
            ? { name: selectedPlan.name, valueCents: selectedPlan.valueCents, minutes: planDurationMinutes(selectedPlan) }
            : null,
      });
      setLastGuardianId(res.guardianId);
      // Assim que a entrada é confirmada, o QR já sobe na tela — o operador
      // vira o kiosk para o responsável sem precisar tocar em mais nada.
      setAcompanharOpen(true);
      onSuccess?.();

      if (quickUpsellAccepted && quickProduct) {
        // Fora do try do check-in de propósito, mesma lógica da foto: a
        // entrada já foi gravada, e o item extra é um adicional na comanda,
        // não algo que pode reverter um check-in já concluído.
        Api.addSessionExtra(res.sessionId, quickProduct.id, employee.id).catch(() =>
          toast.error(`Entrada registrada, mas não foi possível adicionar "${quickProduct.name}" à comanda. Adicione manualmente no fechamento.`),
        );
      }

      if (childPhoto) {
        // Fora do try do check-in de propósito: a entrada já foi gravada, e a
        // foto é só um extra de identificação — uma falha de upload não pode
        // virar "erro ao fazer check-in" na tela.
        Api.uploadChildPhoto(res.childId, childPhoto).catch(() =>
          toast.error("Entrada registrada, mas a foto não pôde ser salva. Você pode tentar de novo na próxima visita."),
        );
      }

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
              {" · "}PIN de saída:{" "}
              <strong style={{ fontFamily: "var(--font-display)", letterSpacing: "3px" }}>{done.exitPin}</strong>
            </span>
          </div>
          {done.contractPlan && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setContractOpen(true)}
              title="Preencher os dados do Responsável Contratante e imprimir o contrato em A4 (2 vias)"
              style={{ borderColor: "var(--color-teal)", color: "var(--color-teal-text)" }}
            >
              📄 Imprimir contrato do plano
            </Button>
          )}
          {lastGuardianId && (
            <Button
              variant="secondary"
              size="sm"
              onClick={addSiblingChild}
              title={`Registrar a entrada de mais uma criança de ${guardianName}`}
            >
              ＋ Mais uma criança deste responsável
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAcompanharOpen(true)}
            title="Mostrar um QR na tela para o responsável acompanhar o tempo pelo próprio celular"
          >
            📱 QR de acompanhamento
          </Button>
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

      {/* Sugestões do Agente IA Comercial Gemini */}
      <GeminiSalesCard
        type="CHECKIN"
        offers={geminiOffers}
        loading={loadingGemini}
        onApplyOffer={handleApplyGeminiOffer}
      />

      {/* ---------------------------------------------------------------- */}
      {/* 1. Quem é a criança                                              */}
      {/* ---------------------------------------------------------------- */}
      <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: 0 }}>1. Quem é a criança</h2>

        {matchedChild ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "var(--surface-sunken)",
                padding: "14px 18px",
                borderRadius: "14px",
                border: "1px solid var(--border-subtle)",
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
                  {cpf ? ` · ${cpf}` : " · ⚠️ Sem CPF registrado"}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => resetForNextChild(false)} title="Buscar outra criança">
                Trocar
              </Button>
            </div>

            {!isValidCpf(cpf) && (
              <div
                style={{
                  padding: "12px 16px",
                  background: "#FEF3C7",
                  color: "#92400E",
                  borderRadius: "12px",
                  border: "1px solid #F59E0B",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <strong style={{ fontSize: "13px" }}>⚠️ CPF do Responsável Obrigatório (NFS-e):</strong>
                <span style={{ fontSize: "12px" }}>
                  O cadastro de <strong>{guardianName || "Responsável"}</strong> está sem CPF. Informe o CPF abaixo para continuar com o check-in:
                </span>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <Input
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    value={cpf}
                    onChange={(e) => setCpf(formatCpf(e.target.value))}
                    style={{ maxWidth: "260px" }}
                  />
                  {cpf.length === 14 && !isValidCpf(cpf) && <Tag color="var(--color-error)">CPF inválido</Tag>}
                </div>
              </div>
            )}
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
              <strong style={{ fontSize: "14px" }}>
                Cadastro novo
                {lastGuardianId && guardianName ? ` — responsável ${guardianName} já preenchido` : ""}
              </strong>
              <Button variant="ghost" size="sm" onClick={() => resetForNextChild(Boolean(lastGuardianId))}>
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <Tag color="var(--color-teal)" title="Os dados do responsável seguem preenchidos para o irmão/irmã">
              ➕ Mesmo responsável ({guardianName}) — busque ou cadastre a próxima criança
            </Tag>
            <Button
              variant="secondary"
              size="sm"
              onClick={addSiblingChild}
              title={`Cadastrar mais uma criança de ${guardianName}, com os dados do responsável já preenchidos`}
            >
              ＋ Mais uma criança deste responsável
            </Button>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* 2. Plano                                                         */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 8px 0" }}>2. Plano de permanência</h2>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {/* Banco de horas antes dos planos pagos, de propósito: a regra é
              usar o saldo que a família já pagou ANTES de vender plano novo. */}
          {matchedChild && hourBank && (
            <Card
              onClick={() => setPlanId(HOUR_BANK)}
              title="Usar o saldo de horas já pago em visitas anteriores (vale em qualquer unidade)"
              style={{
                cursor: "pointer",
                padding: "14px 18px",
                minWidth: "180px",
                borderRadius: "16px",
                border: usingHourBank ? "2px solid var(--color-teal)" : "2px dashed var(--color-teal)",
                background: usingHourBank ? "rgba(46, 207, 181, 0.10)" : "var(--surface-card)",
              }}
            >
              <strong style={{ fontSize: "16px", display: "block", color: "var(--color-teal-text)" }}>
                🕐 Usar banco de horas
              </strong>
              <div style={{ fontSize: "18px", color: "var(--color-teal-text)", fontWeight: "bold", marginTop: "2px" }}>
                {formatPlanoHoras(hourBank.remainingMinutes)} disponíveis
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                vence {new Date(hourBank.nextExpiryMs).toLocaleDateString("pt-BR")} · sem custo de entrada
              </div>
            </Card>
          )}
          {/* Pacotes entram no mesmo grid dos planos, sem seção ou marca
              visual separada — cada um já chegou aqui como um Plan
              sintético (packagePlans). */}
          {[...plans, ...packagePlans].map((plan) => {
            const isPackage = plan.id.startsWith(PACKAGE_PREFIX);
            const minutes = planDurationMinutes(plan);
            // Planos acima de 2h não são mais bloqueados perto do fechamento:
            // a sobra vira crédito no banco de horas em vez de se perder.
            // Só continuam bloqueados quando o shopping já está fechando.
            // Pacotes seguem a mesma regra (o saldo comprado não se perde).
            const fits =
              remainingMinutes === null ||
              minutes <= remainingMinutes ||
              ((minutes > threshold || isPackage) && remainingMinutes > 0);
            const discountInfo = getPlanDiscountedCents(plan.valueCents, couponCode, coupons, plan.id);
            return (
              <Card
                key={plan.id}
                onClick={() => {
                  if (!fits) return;
                  setPlanId(plan.id);
                  if (minutes >= quickTriggerMinutes) {
                    setCrossSellModalOpen(true);
                  }
                }}
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
                <div style={{ marginTop: "4px" }}>
                  {discountInfo.discountText ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)", textDecoration: "line-through" }}>
                        {money(discountInfo.originalCents)}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "18px", color: "var(--color-primary-hover)", fontWeight: "bold" }}>
                          {money(discountInfo.finalCents)}
                        </span>
                        <Badge variant="pink" style={{ background: "rgba(240, 25, 107, 0.12)", color: "var(--color-primary-hover)", fontSize: "11px" }}>
                          {discountInfo.discountText}
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "18px", color: "var(--color-primary-hover)", fontWeight: "bold" }}>
                      {money(plan.valueCents)}
                    </div>
                  )}
                </div>
                {!fits && <div style={{ fontSize: "11px", color: "var(--color-error-text)", fontWeight: "bold", marginTop: "4px" }}>Não cabe até o fechamento</div>}
              </Card>
            );
          })}
        </div>

        {/* Cross-sell rápido: só aparece com plano longo o bastante e
            produto configurado. Um toque liga/desliga — o item só entra
            na comanda de fato depois do check-in confirmado. */}
        {selectedPlan && quickProduct && planDurationMinutes(selectedPlan) >= quickTriggerMinutes && (
          <div
            style={{
              marginTop: "10px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 14px",
              borderRadius: "14px",
              border: quickUpsellAccepted ? "2px solid var(--color-primary)" : "1px dashed var(--border-subtle)",
              background: quickUpsellAccepted ? "rgba(240, 25, 107, 0.06)" : "transparent",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: "20px" }}>{quickProduct.emoji ?? "🛒"}</span>
            <span style={{ flex: 1, minWidth: "180px", fontSize: "14px" }}>
              Oferecer <strong>{quickProduct.name}</strong> por {money(quickProduct.price_cents)}?
            </span>
            <Button
              type="button"
              variant={quickUpsellAccepted ? "primary" : "secondary"}
              size="sm"
              onClick={() => setQuickUpsellAccepted((v) => !v)}
            >
              {quickUpsellAccepted ? "✓ Vai na comanda" : "Adicionar"}
            </Button>
          </div>
        )}
      </section>

      {activity === "CARRINHO" && (
        <section>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 8px 0" }}>3. Carrinho</h2>
          {favoriteAssetId === assetId && assetId && (
            <Tag color="var(--color-teal)" style={{ marginBottom: "8px" }}>
              Carrinho de sempre já reservado
            </Tag>
          )}
          {(() => {
            const visibleAssets = assets.filter((a) => a.name !== "Fusca Amarelo" && a.name !== "Jipe Rosa" && (a.status as string) !== "DESATIVADO" && (a.status as string) !== "EXCLUIDO" && (a.status as string) !== "INATIVO");
            return (
              <>
                {visibleAssets.length > 0 && visibleAssets.every((a) => a.status !== "DISPONIVEL") && (
                  <div
                    role="alert"
                    style={{
                      fontSize: "13px",
                      color: "var(--color-error-text)",
                      background: "rgba(232,48,48,0.08)",
                      border: "1px solid var(--color-error)",
                      borderRadius: "10px",
                      padding: "8px 12px",
                      marginBottom: "10px",
                    }}
                  >
                    ⚠️ Lotação máxima atingida: todos os {visibleAssets.length} carrinhos cadastrados estão em uso ou em manutenção.
                  </div>
                )}
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {visibleAssets.map((asset) => (
              <Card
                key={asset.id}
                onClick={() => asset.status === "DISPONIVEL" && setAssetId(asset.id)}
                style={{
                  cursor: asset.status === "DISPONIVEL" ? "pointer" : "not-allowed",
                  opacity: asset.status === "DISPONIVEL" ? 1 : 0.4,
                  padding: "14px 18px",
                  borderRadius: "16px",
                  border: assetId === asset.id ? "2px solid var(--color-primary)" : "1px solid var(--border-subtle)",
                  background: assetId === asset.id ? "rgba(240, 25, 107, 0.06)" : "var(--surface-card)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  {asset.photo_url ? (
                    <img
                      src={asset.photo_url}
                      alt={asset.name}
                      style={{
                        width: "96px",
                        height: "96px",
                        objectFit: "cover",
                        borderRadius: "14px",
                        border: "1px solid var(--border-subtle)",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: "60px", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "96px", height: "96px" }}>{asset.emoji}</span>
                  )}
                  <span style={{ fontWeight: "var(--weight-bold)" as unknown as number, fontSize: "15px" }}>{asset.name}</span>
                </div>
              </Card>
            ))}
          </div>
        </>
      );
    })()}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Neurodivergência — o checkbox é o gatilho; a área expande inline  */}
      {/* (grid-template-rows 0fr→1fr), nunca em modal, para não tirar o    */}
      {/* operador do formulário nem esconder o resto do fluxo.            */}
      {/* ---------------------------------------------------------------- */}
      <section style={{ border: "1px solid var(--border-subtle)", borderRadius: "14px", padding: "12px 14px" }}>
        <Checkbox
          label="Criança neurodivergente"
          helpText="Marque para registrar cuidados sensoriais e, se quiser, uma foto para identificação."
          checked={isNeurodivergent}
          onChange={(checked) => {
            setIsNeurodivergent(checked);
            if (!checked) {
              setSelectedSensoryTags([]);
              setCustomNotes("");
              setChildPhoto(null);
            }
          }}
        />

        <div
          style={{
            display: "grid",
            gridTemplateRows: isNeurodivergent ? "1fr" : "0fr",
            transition: "grid-template-rows 240ms ease",
          }}
        >
          <div style={{ overflow: "hidden", minHeight: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border-subtle)" }}>
              <strong style={{ fontSize: "15px" }}>🧩 Cuidados Inclusivos &amp; Tags Sensoriais</strong>
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
              <PhotoCapture onChange={setChildPhoto} />
            </div>
          </div>
        </div>
      </section>

      {/* Cupom fica atrás de um toque ou visualizado automaticamente */}
      <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {couponCode && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Tag color="var(--color-teal)" style={{ fontSize: "13px", padding: "6px 12px" }}>
              🎟️ Cupom de desconto ativo: <strong>{couponCode}</strong>
            </Tag>
          </div>
        )}
        {!showExtras ? (
          <Button variant="ghost" size="sm" onClick={() => setShowExtras(true)} style={{ alignSelf: "flex-start" }}>
            {couponCode ? "Alterar cupom de desconto" : "＋ Aplicar cupom de desconto"}
          </Button>
        ) : (
          <Select label="Cupom de desconto / parceria" value={couponCode} onChange={(e) => setCouponCode(e.target.value)}>
            <option value="">Nenhum</option>
            {eligibleCoupons.map((c) => (
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
          Confirmar entrada
          {usingHourBank
            ? " — Banco de horas (R$ 0,00)"
            : selectedPlan
              ? ` — ${money(
                  getPlanDiscountedCents(selectedPlan.valueCents, couponCode, coupons, selectedPlan.id).finalCents +
                    (quickUpsellAccepted && quickProduct ? quickProduct.price_cents : 0),
                )}`
              : ""}
        </Button>
      </div>

      {/* Contrato dos planos acima de 2h: dados do Responsável Contratante
          + impressão A4 com timbre da unidade, em 2 vias. */}
      {contractOpen && done?.contractPlan && (
        <ContractModal
          guardianId={done.guardianId}
          childName={done.childName}
          plan={done.contractPlan}
          onClose={() => setContractOpen(false)}
        />
      )}

      {/* QR de acompanhamento: mostrado na tela, não impresso — evita
          mexer no QR já impresso na pulseira/recibo (aquele é lido pelo
          scanner do operador na saída via fa_kiosk_normalize_access_code,
          que quebraria se virasse uma URL). Este é só para o responsável
          apontar a câmera do próprio celular, oferecido pela operadora. */}
      {acompanharOpen && done && (
        <Modal title="📱 Apresentar ao Responsável" onClose={() => setAcompanharOpen(false)}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "8px 0" }}>
            {acompanharUrl ? (
              <>
                <p
                  style={{
                    margin: 0,
                    textAlign: "center",
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "var(--color-teal-text)",
                  }}
                >
                  Vire a tela e apresente este QR Code ao responsável de {done.childName.split(" ")[0]}
                </p>
                <p style={{ margin: 0, textAlign: "center", fontSize: "13px", color: "var(--text-muted)" }}>
                  Basta apontar a câmera do celular para o QR abaixo — o painel de acompanhamento abre na hora, sem
                  precisar de cadastro.
                </p>
                {/* Mesmo cronômetro que o responsável vê no celular assim que
                    escaneia o QR — roda aqui no balcão em paralelo, pela
                    mesma sessão, para o operador confirmar de relance que o
                    tempo já está contando antes de liberar a criança. */}
                {acompanharTiming && (
                  <StatusBadge
                    phase={acompanharTiming.phase}
                    detail={formatElapsed(acompanharTiming.elapsedMs)}
                    size="lg"
                    style={{ width: "100%", alignItems: "center", textAlign: "center" }}
                  />
                )}
                <WristbandQRCode value={acompanharUrl} size={220} />
              </>
            ) : (
              <div style={{ background: "var(--surface-sunken)", borderRadius: "12px", padding: "14px", fontSize: "13px" }}>
                <strong>Endereço público ainda não configurado.</strong>
                <HelpText>
                  Este computador está rodando no endereço local ({window.location.origin}), que o celular do
                  responsável não alcança. Defina <code>VITE_PUBLIC_APP_URL</code> (URL do deploy na Vercel) no build
                  para o QR de acompanhamento funcionar aqui — o mesmo endereço já usado em "Conectar celular ou
                  tablet".
                </HelpText>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Modal de Cross-Selling Automático para pacotes >= 1h */}
      {crossSellModalOpen && (
        <Modal onClose={() => setCrossSellModalOpen(false)} title="🥤 Oportunidade de Venda (Cross-Selling)">
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "4px" }}>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--text-muted)" }}>
              O cliente selecionou um pacote de{" "}
              <strong>
                {selectedPlan
                  ? planDurationMinutes(selectedPlan) >= 60 && planDurationMinutes(selectedPlan) % 60 === 0
                    ? `${planDurationMinutes(selectedPlan) / 60}h`
                    : `${planDurationMinutes(selectedPlan)} min`
                  : "1h"}
              </strong>
              . Ofereça o produto adicional utilizando o script abaixo:
            </p>

            {/* Script destacado para o operador ler */}
            <div
              style={{
                border: "2px solid var(--color-orange, #ff7a00)",
                background: "rgba(255, 122, 0, 0.08)",
                borderRadius: "14px",
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: "bold",
                  color: "var(--color-orange-text, #d96300)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Script de Abordagem
              </div>
              <blockquote
                style={{
                  margin: 0,
                  fontSize: "18px",
                  lineHeight: 1.5,
                  fontWeight: "600",
                  color: "var(--text-primary)",
                  borderLeft: "4px solid var(--color-orange, #ff7a00)",
                  paddingLeft: "12px",
                }}
              >
                “Por mais {money(quickProduct ? quickProduct.price_cents : 500)}, você quer adicionar uma água para ele?{" "}
                {selectedPlan
                  ? planDurationMinutes(selectedPlan) >= 60 && planDurationMinutes(selectedPlan) % 60 === 0
                    ? `${planDurationMinutes(selectedPlan) / 60} ${planDurationMinutes(selectedPlan) === 60 ? "hora" : "horas"}`
                    : `${planDurationMinutes(selectedPlan)} minutos`
                  : "1 hora"}{" "}
                vai dar bem sede!”
              </blockquote>
            </div>

            {/* Botões de Ação */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "8px" }}>
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={() => {
                  setQuickUpsellAccepted(true);
                  setCrossSellModalOpen(false);
                  toast.success(`${quickProduct?.name ?? "Água"} adicionada ao pedido!`);
                }}
                style={{
                  flex: 1,
                  minWidth: "220px",
                  borderRadius: "9999px",
                  background: "var(--color-orange, #ff7a00)",
                  borderColor: "var(--color-orange, #ff7a00)",
                }}
              >
                ✓ Sim, adicionar água (+ {money(quickProduct ? quickProduct.price_cents : 500)})
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => {
                  setQuickUpsellAccepted(false);
                  setCrossSellModalOpen(false);
                }}
                style={{ flex: 1, minWidth: "180px", borderRadius: "9999px" }}
              >
                ✕ Não, apenas o pacote
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
