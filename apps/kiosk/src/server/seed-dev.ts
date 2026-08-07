import {
  listUnits,
  insertUnit,
  insertEmployee,
  upsertLocalCredentials,
  insertPlan,
  insertProduct,
  insertAsset,
  insertCoupon,
  insertLoyaltyRule,
  uuidv7,
  type Db,
} from "@facaamigos/db-local";
import { hashPin } from "./security/pin.js";

/**
 * Seed de desenvolvimento — mesma tabela de preços do site (tools/scripts/seed-dev.ts
 * completo, com as duas unidades, é trabalho de Fase 1 posterior; isto
 * cobre o suficiente para exercitar a API manualmente agora).
 */
export function seedDevData(db: Db, nowMs: number): void {
  if (listUnits(db).length > 0) return;

  // 1. Módulo Playground — Parque Shopping Belém (Operação Brinquedoteca / Espaço Físico)
  const playgroundId = uuidv7(nowMs);
  insertUnit(db, { id: playgroundId, kind: "LOJA", name: "Playground (Parque Shopping)" }, nowMs);

  // 2. Módulo Circuito — Parque Shopping Belém (Operação Quiosque / Carrinhos Elétricos)
  const circuitoId = uuidv7(nowMs);
  insertUnit(db, { id: circuitoId, kind: "QUIOSQUE", name: "Circuito (Parque Shopping)" }, nowMs);

  // 3. Módulo Playground — Shopping Bosque Grão-Pará (Nova Operação Inclusiva)
  const graoParaId = uuidv7(nowMs);
  insertUnit(db, { id: graoParaId, kind: "LOJA", name: "Playground (Bosque Grão-Pará)" }, nowMs);

  const adminId = uuidv7(nowMs);
  insertEmployee(db, { id: adminId, full_name: "Admin Dev", role: "ADMIN", pis: null, cpf_last4: null }, nowMs);
  upsertLocalCredentials(db, adminId, hashPin("000000"), nowMs);

  const admin2Id = uuidv7(nowMs);
  insertEmployee(db, { id: admin2Id, full_name: "Admin 2", role: "ADMIN", pis: null, cpf_last4: null }, nowMs);
  upsertLocalCredentials(db, admin2Id, hashPin("000000"), nowMs);

  // Planos - Playground (Parque Shopping)
  insertPlan(db, playgroundId, { id: uuidv7(nowMs), activity: "PLAYGROUND", name: "30 minutos", valueCents: 4000, durationValue: 30, durationUnit: "MINUTO", overageCentsPerMinute: 150, color: "#2ECFB5" }, nowMs);
  insertPlan(db, playgroundId, { id: uuidv7(nowMs), activity: "PLAYGROUND", name: "1 hora", valueCents: 6000, durationValue: 1, durationUnit: "HORA", overageCentsPerMinute: 150, color: "#F0196B" }, nowMs);
  insertPlan(db, playgroundId, { id: uuidv7(nowMs), activity: "PLAYGROUND", name: "Day Use (5h)", valueCents: 27000, durationValue: 5, durationUnit: "HORA", overageCentsPerMinute: 180, color: "#A020EE" }, nowMs);

  // Planos - Circuito (Parque Shopping)
  insertPlan(db, circuitoId, { id: uuidv7(nowMs), activity: "CARRINHO", name: "15 minutos", valueCents: 3000, durationValue: 15, durationUnit: "MINUTO", overageCentsPerMinute: 100, color: "#2ECFB5" }, nowMs);
  insertPlan(db, circuitoId, { id: uuidv7(nowMs), activity: "CARRINHO", name: "30 minutos", valueCents: 5500, durationValue: 30, durationUnit: "MINUTO", overageCentsPerMinute: 100, color: "#FFE234" }, nowMs);

  // Planos - Grão-Pará (Bosque Grão-Pará)
  insertPlan(db, graoParaId, { id: uuidv7(nowMs), activity: "PLAYGROUND", name: "30 minutos", valueCents: 4000, durationValue: 30, durationUnit: "MINUTO", overageCentsPerMinute: 150, color: "#2ECFB5" }, nowMs);
  insertPlan(db, graoParaId, { id: uuidv7(nowMs), activity: "PLAYGROUND", name: "1 hora", valueCents: 6000, durationValue: 1, durationUnit: "HORA", overageCentsPerMinute: 150, color: "#F0196B" }, nowMs);
  insertPlan(db, graoParaId, { id: uuidv7(nowMs), activity: "PLAYGROUND", name: "Day Use (5h)", valueCents: 27000, durationValue: 5, durationUnit: "HORA", overageCentsPerMinute: 180, color: "#A020EE" }, nowMs);

  // Produtos & Suprimentos
  insertProduct(db, { id: uuidv7(nowMs), unit_id: playgroundId, name: "Água mineral", description: "Garrafa 500ml", emoji: "💧", price_cents: 500, stock: 40 }, nowMs);
  insertProduct(db, { id: uuidv7(nowMs), unit_id: playgroundId, name: "Meia antiderrapante", description: "Tamanho único infantil", emoji: "🧦", price_cents: 1500, stock: 25 }, nowMs);
  insertProduct(db, { id: uuidv7(nowMs), unit_id: graoParaId, name: "Água mineral", description: "Garrafa 500ml", emoji: "💧", price_cents: 500, stock: 50 }, nowMs);
  insertProduct(db, { id: uuidv7(nowMs), unit_id: graoParaId, name: "Meia antiderrapante", description: "Tamanho único infantil", emoji: "🧦", price_cents: 1500, stock: 35 }, nowMs);
  insertProduct(db, { id: uuidv7(nowMs), unit_id: graoParaId, name: "Suco de Fruta", description: "Caixinha 200ml", emoji: "🧃", price_cents: 700, stock: 30 }, nowMs);

  // Frota Carrinhos (Circuito)
  insertAsset(db, { id: uuidv7(nowMs), unit_id: circuitoId, name: "Jipe Rosa", emoji: "🚙", color: "#F0196B", maintenance_threshold_hours: 200 }, nowMs);
  insertAsset(db, { id: uuidv7(nowMs), unit_id: circuitoId, name: "Fusca Amarelo", emoji: "🚗", color: "#FFE234", maintenance_threshold_hours: 200 }, nowMs);

  // Cupons & Fidelidade
  insertCoupon(db, { id: uuidv7(nowMs), unit_id: playgroundId, code: "AMIGO10", kind: "MINUTOS_EXTRA", value: 10, max_uses: 0, description: "10 minutos extras — avaliação no Google" }, nowMs);
  insertCoupon(db, { id: uuidv7(nowMs), unit_id: graoParaId, code: "GRAOPARA10", kind: "MINUTOS_EXTRA", value: 10, max_uses: 0, description: "10 minutos extras — inauguração Grão-Pará" }, nowMs);
  
  insertLoyaltyRule(db, { id: uuidv7(nowMs), unit_id: playgroundId, activity: "PLAYGROUND", trigger_visits: 10, reward_kind: "ENTRADA_GRATIS", reward_value: 1 }, nowMs);
  insertLoyaltyRule(db, { id: uuidv7(nowMs), unit_id: graoParaId, activity: "PLAYGROUND", trigger_visits: 10, reward_kind: "ENTRADA_GRATIS", reward_value: 1 }, nowMs);
}
