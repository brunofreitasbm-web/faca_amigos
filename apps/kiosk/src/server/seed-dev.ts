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

  const lojaId = uuidv7(nowMs);
  insertUnit(db, { id: lojaId, kind: "LOJA", name: "Loja (Playground)" }, nowMs);
  const quiosqueId = uuidv7(nowMs);
  insertUnit(db, { id: quiosqueId, kind: "QUIOSQUE", name: "Quiosque (Circuito)" }, nowMs);

  const adminId = uuidv7(nowMs);
  insertEmployee(db, { id: adminId, full_name: "Admin Dev", role: "ADMIN", pis: null, cpf_last4: null }, nowMs);
  upsertLocalCredentials(db, adminId, hashPin("000000"), nowMs);

  insertPlan(db, lojaId, { id: uuidv7(nowMs), activity: "PLAYGROUND", name: "30 minutos", valueCents: 4000, durationValue: 30, durationUnit: "MINUTO", overageCentsPerMinute: 150 }, nowMs);
  insertPlan(db, lojaId, { id: uuidv7(nowMs), activity: "PLAYGROUND", name: "1 hora", valueCents: 6000, durationValue: 1, durationUnit: "HORA", overageCentsPerMinute: 150 }, nowMs);
  insertPlan(db, lojaId, { id: uuidv7(nowMs), activity: "PLAYGROUND", name: "Day Use (5h)", valueCents: 27000, durationValue: 5, durationUnit: "HORA", overageCentsPerMinute: 180 }, nowMs);
  insertPlan(db, quiosqueId, { id: uuidv7(nowMs), activity: "CARRINHO", name: "15 minutos", valueCents: 3000, durationValue: 15, durationUnit: "MINUTO", overageCentsPerMinute: 100 }, nowMs);
  insertPlan(db, quiosqueId, { id: uuidv7(nowMs), activity: "CARRINHO", name: "30 minutos", valueCents: 5500, durationValue: 30, durationUnit: "MINUTO", overageCentsPerMinute: 100 }, nowMs);

  insertProduct(db, { id: uuidv7(nowMs), unit_id: lojaId, name: "Água mineral", description: "Garrafa 500ml", emoji: "💧", price_cents: 500, stock: 40 }, nowMs);
  insertProduct(db, { id: uuidv7(nowMs), unit_id: lojaId, name: "Meia antiderrapante", description: "Tamanho único infantil", emoji: "🧦", price_cents: 1500, stock: 25 }, nowMs);

  insertAsset(db, { id: uuidv7(nowMs), unit_id: quiosqueId, name: "Jipe Rosa", emoji: "🚙", color: "#F0196B", maintenance_threshold_hours: 200 }, nowMs);
  insertAsset(db, { id: uuidv7(nowMs), unit_id: quiosqueId, name: "Fusca Amarelo", emoji: "🚗", color: "#FFE234", maintenance_threshold_hours: 200 }, nowMs);

  insertCoupon(db, { id: uuidv7(nowMs), unit_id: lojaId, code: "AMIGO10", kind: "MINUTOS_EXTRA", value: 10, max_uses: 0, description: "10 minutos extras — avaliação no Google" }, nowMs);

  insertLoyaltyRule(db, { id: uuidv7(nowMs), unit_id: lojaId, activity: "PLAYGROUND", trigger_visits: 10, reward_kind: "ENTRADA_GRATIS", reward_value: 1 }, nowMs);
}
