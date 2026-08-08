import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { childrenBirthdaysInMonth } from "@facaamigos/db-local";

export interface AniversarianteItem {
  id: string;
  child_name: string;
  birth_date: string;
  guardian_name: string;
  phone_e164: string;
  is_today: boolean;
  day_of_month: number;
}

const ANIVERSARIO_TEMPLATES = [
  {
    id: "parabens_presente",
    title: "Parabéns com Presente de 30 Minutos Grátis",
    message: "Parabéns, {crianca}! 🎂🎈 O Faça Amigos deseja um aniversário repleto de alegria e brincadeiras! Como nosso presente especial para o(a) {crianca}, vocês ganharam 30 MINUTOS GRÁTIS na próxima visita este mês! Apresente esta mensagem na recepção. 🎉🎁",
  },
  {
    id: "cupom_aniversario",
    title: "Convite para Festa / Pacote Especial",
    message: "Olá {responsavel}! O aniversário do(a) {crianca} está chegando! 🎉 Sabia que você pode comemorar esse dia especial aqui no Faça Amigos? Fale com nossa equipe para garantir um pacote exclusivo com desconto de aniversário! 🎁🎂",
  },
];

export function registerAniversariosRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { month?: string } }>("/api/aniversarios", async (req) => {
    const currentMonth = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
    const todayDay = new Date().getDate();

    try {
      const dbBirthdays = childrenBirthdaysInMonth(ctx.db, currentMonth);

      // Join guardians to get phone and guardian name
      const items: AniversarianteItem[] = dbBirthdays.map((c) => {
        let guardianName = "Responsável";
        let phoneE164 = "";

        try {
          const gRow = ctx.db
            .prepare(
              `SELECT g.full_name, g.phone_e164
               FROM guardians g
               JOIN child_guardians cg ON cg.guardian_id = g.id
               WHERE cg.child_id = ?
               LIMIT 1`
            )
            .get(c.id) as { full_name: string; phone_e164: string } | undefined;

          if (gRow) {
            guardianName = gRow.full_name;
            phoneE164 = gRow.phone_e164 || "";
          }
        } catch {
          // ignore fallback
        }

        const dayOfMonth = Number(c.birth_date.substring(8, 10)) || 1;
        const isToday = dayOfMonth === todayDay;

        return {
          id: c.id,
          child_name: c.full_name,
          birth_date: c.birth_date,
          guardian_name: guardianName,
          phone_e164: phoneE164,
          is_today: isToday,
          day_of_month: dayOfMonth,
        };
      });

      // Sort by day of month
      items.sort((a, b) => a.day_of_month - b.day_of_month);

      return { items, month: currentMonth };
    } catch {
      return { items: [], month: currentMonth };
    }
  });

  app.get("/api/aniversarios/templates", async () => {
    return { templates: ANIVERSARIO_TEMPLATES };
  });
}
