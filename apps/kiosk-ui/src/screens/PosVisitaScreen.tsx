import { useState, useEffect } from "react";
import { Card, Button, Badge } from "@facaamigos/ui";
import { useAppState } from "../state/AppState.js";

interface PosVisitaItem {
  id: string;
  guardian_name: string;
  phone_e164: string;
  child_name: string;
  last_visit_date: string;
  status: "PENDENTE" | "CONTATADO";
  notes?: string;
}

interface Template {
  id: string;
  title: string;
  message: string;
}

export function PosVisitaScreen() {
  const { unit } = useAppState();
  const [items, setItems] = useState<PosVisitaItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filter, setFilter] = useState<string>("TODOS");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("padrao_agradecimento");
  const [customNotes, setCustomNotes] = useState<Record<string, string>>({});
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => setCooldownSeconds((prev) => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  useEffect(() => {
    fetch(`/api/pos-visita?unitId=${unit?.id || ""}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.items) setItems(data.items);
      })
      .catch(() => {
        setItems([
          { id: "pv_1", guardian_name: "Mariana Silva", phone_e164: "+5591988887777", child_name: "Lucas Silva", last_visit_date: new Date().toISOString().split("T")[0] || "2026-08-08", status: "PENDENTE" },
          { id: "pv_2", guardian_name: "Roberto Lima", phone_e164: "+5591999991111", child_name: "Sophia Lima", last_visit_date: "2026-08-05", status: "CONTATADO", notes: "Adoraram o brinquedo de carrinhos" },
          { id: "pv_3", guardian_name: "Camila Rocha", phone_e164: "+5591977772222", child_name: "Enzo Rocha", last_visit_date: "2026-08-04", status: "PENDENTE", notes: "Muito elogiado pelos monitores" },
        ]);
      });

    fetch("/api/pos-visita/templates")
      .then((res) => res.json())
      .then((data) => {
        if (data.templates) setTemplates(data.templates);
      })
      .catch(() => {
        setTemplates([
          { 
            id: "padrao_agradecimento", 
            title: "Agradecimento e Convite", 
            message: "Olá {responsavel}! Tudo bem? 😊 Nós do Faça Amigos amamos receber a visita do(a) {crianca}!\n\nEsperamos que a experiência tenha sido incrível! Já estamos com saudades e preparamos muitas novidades divertidas para a próxima brincadeira! 🎈\n\n⭐ Avalie a gente com 5 estrelas no Google e garanta 10% de DESCONTO na sua próxima visita no Faça Amigos Circuito (válido por 7 dias)! \n👉 https://institutofacaamigos.com.br/playground/index.html\n\nTe esperamos em breve!" 
          }
        ]);
      });
  }, [unit?.id]);

  function getFormattedMessage(templateId: string, guardianName: string, childName: string) {
    const tmpl = templates.find((t) => t.id === templateId) || templates[0];
    if (!tmpl) return "";
    return tmpl.message.replace("{responsavel}", guardianName).replace("{crianca}", childName);
  }

  function handleSendWhatsApp(item: PosVisitaItem) {
    if (cooldownSeconds > 0) return;

    const rawPhone = item.phone_e164.replace(/\D/g, "");
    const text = encodeURIComponent(getFormattedMessage(selectedTemplate, item.guardian_name, item.child_name));
    const url = `https://wa.me/${rawPhone}?text=${text}`;
    window.open(url, "_blank");

    // Gerar cooldown aleatório entre 5 e 20 segundos
    const randomCooldown = Math.floor(Math.random() * (20 - 5 + 1)) + 5;
    setCooldownSeconds(randomCooldown);

    // Remove imediatamente da interface
    setItems((prev) => prev.filter((i) => i.id !== item.id));

    // Atualiza apenas no backend
    fetch("/api/pos-visita", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, status: "CONTATADO", notes: customNotes[item.id] }),
    }).catch(() => null);
  }

  function handleUpdateStatus(id: string, newStatus: PosVisitaItem["status"]) {
    const notes = customNotes[id];
    fetch("/api/pos-visita", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: newStatus, notes }),
    }).catch(() => null);

    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: newStatus, notes: notes ?? item.notes } : item)));
  }

  const filteredItems = filter === "TODOS" ? items : items.filter((i) => i.status === filter);

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 6px 0", color: "var(--text-primary)" }}>
            📱 Pós-Visita & Experiência do Cliente
          </h1>
          <p style={{ color: "var(--text-muted)", margin: 0, fontSize: "14px" }}>
            Acompanhamento de satisfação pós-atendimento e envio ágil de mensagens via WhatsApp.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          {["TODOS", "PENDENTE", "CONTATADO"].map((st) => (
            <Button
              key={st}
              variant={filter === st ? "teal" : "ghost"}
              size="sm"
              onClick={() => setFilter(st)}
              style={{ fontSize: "12px" }}
            >
              {st}
            </Button>
          ))}
        </div>
      </div>

      {/* Modelo de mensagem selecionado */}
      <Card style={{ padding: "20px", marginBottom: "24px", borderRadius: "16px", background: "var(--surface-card)" }}>
        <h3 style={{ fontSize: "16px", margin: "0 0 12px 0", color: "var(--text-primary)" }}>
          💬 Modelo de Mensagem Selecionado
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
            fontStyle: "italic",
            borderLeft: "4px solid var(--color-primary)",
          }}
        >
          {templates.find((t) => t.id === selectedTemplate)?.message}
        </div>
      </Card>

      {/* Lista de clientes */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }}>
        {filteredItems.map((item) => (
          <Card key={item.id} style={{ padding: "20px", borderRadius: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ fontSize: "18px", margin: "0 0 4px 0", color: "var(--text-primary)" }}>{item.guardian_name}</h3>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
                  Criança: <strong>{item.child_name}</strong>
                </p>
              </div>
              <Badge
                variant={
                  item.status === "CONTATADO"
                    ? "amber"
                    : "neutral"
                }
              >
                {item.status}
              </Badge>
            </div>

            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              <span>📅 Última Visita: {item.last_visit_date}</span>
              <br />
              <span>📞 Wpp: {item.phone_e164 || "Não informado"}</span>
            </div>

            {item.notes && (
              <div style={{ fontSize: "12px", background: "var(--surface-sunken)", padding: "8px 12px", borderRadius: "8px" }}>
                📝 {item.notes}
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", marginTop: "auto", paddingTop: "8px" }}>
              <Button
                variant={cooldownSeconds > 0 ? "ghost" : "teal"}
                size="sm"
                disabled={cooldownSeconds > 0}
                onClick={() => handleSendWhatsApp(item)}
                style={{ flex: 1, fontWeight: "bold" }}
              >
                {cooldownSeconds > 0 ? `⏳ Aguarde (${cooldownSeconds}s)` : "📱 Enviar WhatsApp"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
