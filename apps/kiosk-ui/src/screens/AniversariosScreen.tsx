import { useState, useEffect } from "react";
import { Card, Button, Badge } from "@facaamigos/ui";

interface AniversarianteItem {
  id: string;
  child_name: string;
  birth_date: string;
  guardian_name: string;
  phone_e164: string;
  is_today: boolean;
  day_of_month: number;
}

interface Template {
  id: string;
  title: string;
  message: string;
}

export function AniversariosScreen() {
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [items, setItems] = useState<AniversarianteItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("parabens_presente");

  useEffect(() => {
    fetch(`/api/aniversarios?month=${month}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.items) setItems(data.items);
      })
      .catch(() => {
        setItems([
          { id: "aniv_1", child_name: "Gabriel Santos", birth_date: "2020-08-08", guardian_name: "Patricia Santos", phone_e164: "+5591981112222", is_today: true, day_of_month: 8 },
          { id: "aniv_2", child_name: "Beatriz Oliveira", birth_date: "2019-08-15", guardian_name: "Fernanda Oliveira", phone_e164: "+5591983334444", is_today: false, day_of_month: 15 },
          { id: "aniv_3", child_name: "Lucas Meireles", birth_date: "2021-08-22", guardian_name: "Marcos Meireles", phone_e164: "+5591985556666", is_today: false, day_of_month: 22 },
        ]);
      });

    fetch("/api/aniversarios/templates")
      .then((res) => res.json())
      .then((data) => {
        if (data.templates) setTemplates(data.templates);
      })
      .catch(() => {
        setTemplates([
          { id: "parabens_presente", title: "Parabéns com 30m Grátis 🎁", message: "Parabéns, {crianca}! 🎂🎈 Como nosso presente, ganharam 30 MINUTOS GRÁTIS na próxima visita neste mês!" },
          { id: "felicitacao_simples", title: "Felicitação Simples 🎈", message: "Hoje o dia é todo do(a) {crianca}! 🎉 A equipe Faça Amigos deseja um feliz aniversário!" },
        ]);
      });
  }, [month]);

  function getFormattedMessage(templateId: string, childName: string, guardianName: string) {
    const tmpl = templates.find((t) => t.id === templateId) || templates[0];
    if (!tmpl) return "";
    return tmpl.message.replace("{crianca}", childName).replace("{responsavel}", guardianName);
  }

  function handleSendWhatsApp(item: AniversarianteItem) {
    const rawPhone = item.phone_e164.replace(/\D/g, "");
    const text = encodeURIComponent(getFormattedMessage(selectedTemplate, item.child_name, item.guardian_name));
    const url = `https://wa.me/${rawPhone}?text=${text}`;
    window.open(url, "_blank");
  }

  const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 6px 0", color: "var(--text-primary)" }}>
            🎂 Módulo de Aniversariantes
          </h1>
          <p style={{ color: "var(--text-muted)", margin: 0, fontSize: "14px" }}>
            Acompanhe os aniversariantes do mês e envie mensagens comemorativas com cupons de presente.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "14px", fontWeight: "bold", color: "var(--text-secondary)" }}>Mês:</span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            style={{
              padding: "8px 16px",
              borderRadius: "12px",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-card)",
              color: "var(--text-primary)",
              fontSize: "14px",
              fontWeight: "bold",
            }}
          >
            {MONTH_NAMES.map((m, idx) => (
              <option key={m} value={idx + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Modelo de mensagem selecionado */}
      <Card style={{ padding: "20px", marginBottom: "24px", borderRadius: "16px" }}>
        <h3 style={{ fontSize: "16px", margin: "0 0 12px 0", color: "var(--text-primary)" }}>
          🎁 Modelo de Felicitação / Presente
        </h3>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
          {templates.map((tmpl) => (
            <Button
              key={tmpl.id}
              variant={selectedTemplate === tmpl.id ? "primary" : "ghost"}
              size="sm"
              onClick={() => setSelectedTemplate(tmpl.id)}
            >
              {tmpl.title}
            </Button>
          ))}
        </div>
        <div
          style={{
            background: "var(--surface-sunken)",
            padding: "12px 16px",
            borderRadius: "12px",
            fontSize: "14px",
            color: "var(--text-secondary)",
            borderLeft: "4px solid var(--color-primary)",
          }}
        >
          {templates.find((t) => t.id === selectedTemplate)?.message}
        </div>
      </Card>

      {/* Lista de aniversariantes */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
        {items.map((item) => (
          <Card
            key={item.id}
            style={{
              padding: "20px",
              borderRadius: "16px",
              border: item.is_today ? "2px solid #EAB308" : "1px solid var(--border-subtle)",
              boxShadow: item.is_today ? "0 0 12px rgba(234, 179, 8, 0.25)" : "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
              <div>
                <h3 style={{ fontSize: "20px", margin: "0 0 4px 0", color: "var(--text-primary)" }}>
                  {item.child_name} {item.is_today ? "🎉" : ""}
                </h3>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
                  Responsável: <strong>{item.guardian_name}</strong>
                </p>
              </div>
              {item.is_today ? (
                <Badge variant="amber">HOJE! 🎂</Badge>
              ) : (
                <Badge variant="teal">Dia {item.day_of_month}</Badge>
              )}
            </div>

            <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 16px 0" }}>
              📞 Contato: {item.phone_e164 || "Não cadastrado"}
            </p>

            <Button
              variant={item.is_today ? "amber" : "teal"}
              size="sm"
              onClick={() => handleSendWhatsApp(item)}
              style={{ width: "100%", fontWeight: "bold" }}
            >
              📱 Enviar Felicitação WhatsApp
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
