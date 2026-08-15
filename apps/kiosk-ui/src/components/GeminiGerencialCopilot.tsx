import { useEffect, useState } from "react";
import { Card, Button, Input, Select, HelpText, Badge } from "@facaamigos/ui";
import {
  generateGerencialInsights,
  chatGerencialCopilot,
  getGeminiSettings,
  saveGeminiSettings,
  testGeminiApiKey,
  type GerencialInsight,
  type ChatMessage,
  type GeminiModel,
} from "../lib/geminiAgent.js";

interface GeminiGerencialCopilotProps {
  metricsSummary?: string;
}

export function GeminiGerencialCopilot({ metricsSummary }: GeminiGerencialCopilotProps) {
  const [insights, setInsights] = useState<GerencialInsight[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "model",
      text: "Olá! Sou a ZoeIA, sua parceira de inteligência comercial do FaçaAmigos. Como posso ajudar a aumentar o faturamento e otimizar as vendas da sua unidade hoje?",
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [busyChat, setBusyChat] = useState(false);

  // Estado das Configurações da API Key
  const [showConfig, setShowConfig] = useState(false);
  const settings = getGeminiSettings();
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState<GeminiModel>(settings.model);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const defaultMetricsContext =
    metricsSummary ||
    "Faturamento Hoje: R$ 3.850,00 | Ticket Médio: R$ 48,00 | Ocupação Média: 65% | Total Visitas: 80 crianças | Meias Vendidas: 14 unidades.";

  useEffect(() => {
    let active = true;
    setLoadingInsights(true);
    generateGerencialInsights(defaultMetricsContext)
      .then((res) => {
        if (active) setInsights(res);
      })
      .finally(() => {
        if (active) setLoadingInsights(false);
      });
    return () => {
      active = false;
    };
  }, [defaultMetricsContext]);

  async function handleSendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || busyChat) return;

    const userText = inputMessage.trim();
    setInputMessage("");
    const updatedHistory: ChatMessage[] = [...messages, { role: "user", text: userText }];
    setMessages(updatedHistory);
    setBusyChat(true);

    try {
      const reply = await chatGerencialCopilot(updatedHistory, userText, defaultMetricsContext);
      setMessages([...updatedHistory, { role: "model", text: reply }]);
    } catch (err) {
      setMessages([
        ...updatedHistory,
        {
          role: "model",
          text: "Desculpe, ocorreu um erro ao consultar a inteligência comercial. Tente novamente.",
        },
      ]);
    } finally {
      setBusyChat(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Banner de Cabeçalho do Copilot */}
      <section
        style={{
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
          color: "#ffffff",
          borderRadius: "18px",
          padding: "20px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          boxShadow: "0 10px 25px rgba(49, 46, 129, 0.2)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span
              style={{
                background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
                color: "#ffffff",
                fontWeight: "bold",
                fontSize: "12px",
                padding: "4px 12px",
                borderRadius: "9999px",
              }}
            >
              ✦ ZOEIA — COPILOT COMERCIAL
            </span>
            {settings.enabled && settings.apiKey ? (
              <span style={{ fontSize: "12px", color: "#4ade80", fontWeight: "600" }}>● ZoeIA Conectada (Gemini API)</span>
            ) : (
              <span style={{ fontSize: "12px", color: "#facc15", fontWeight: "600" }}>● ZoeIA em Modo Fallback</span>
            )}
          </div>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "22px", color: "#ffffff" }}>
            ZoeIA · Insights Estratégicos & Atendimento
          </h2>
          <p style={{ margin: "6px 0 0 0", color: "#c7d2fe", fontSize: "14px", maxWidth: "600px" }}>
            Análise humanizada e automatizada de faturamento, ticket médio, ocupação e estratégias de venda recomendadas para a sua unidade.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowConfig(!showConfig)}
            style={{ background: "rgba(255,255,255,0.15)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.25)" }}
          >
            {showConfig ? "✕ Fechar Configuração" : "⚙️ Configurar Chave Gemini"}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLoadingInsights(true);
              generateGerencialInsights(defaultMetricsContext).then((res) => {
                setInsights(res);
                setLoadingInsights(false);
              });
            }}
            disabled={loadingInsights}
            style={{ background: "rgba(255,255,255,0.1)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.2)" }}
          >
            {loadingInsights ? "Atualizando..." : "↻ Recarregar Insights"}
          </Button>
        </div>
      </section>

      {/* Painel de Configurações da Gemini API Key */}
      {showConfig && (
        <Card style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", border: "2px solid #7c3aed" }}>
          <div>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 4px 0", color: "var(--text-primary)" }}>
              ⚙️ Configuração da Gemini API Key (Exclusivo Gerencial)
            </h3>
            <HelpText style={{ margin: 0 }}>
              Insira a chave de API do Google Gemini para alimentar as sugestões de vendas do balcão e este assistente gerencial.
            </HelpText>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <label style={{ fontSize: "14px", fontWeight: "bold", display: "block", marginBottom: "6px" }}>
                Gemini API Key
              </label>
              <Input
                type="password"
                placeholder="AQ.Ab8RN..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <HelpText style={{ marginTop: "4px" }}>
                Chave atual encriptada no navegador / servidor.
              </HelpText>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "14px", fontWeight: "bold", display: "block", marginBottom: "6px" }}>
                  Modelo da IA
                </label>
                <Select value={model} onChange={(e) => setModel(e.target.value as GeminiModel)}>
                  <option value="gemini-flash-latest">Gemini Flash Latest (API Direct)</option>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash (Ultra Rápido)</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash (Recente)</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro (Raciocínio Avançado)</option>
                </Select>
              </div>

              <div>
                <label style={{ fontSize: "14px", fontWeight: "bold", display: "block", marginBottom: "6px" }}>
                  Status do Agente
                </label>
                <Select value={enabled ? "true" : "false"} onChange={(e) => setEnabled(e.target.value === "true")}>
                  <option value="true">Ativo (Gerar sugestões no PDV e Gerencial)</option>
                  <option value="false">Desativado (Usar apenas fallback estático)</option>
                </Select>
              </div>
            </div>

            {testResult && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: "600",
                  background: testResult.success ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                  color: testResult.success ? "#16a34a" : "#dc2626",
                  border: `1px solid ${testResult.success ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                }}
              >
                {testResult.message}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
              <Button
                variant="secondary"
                disabled={testing || !apiKey.trim()}
                onClick={async () => {
                  setTesting(true);
                  setTestResult(null);
                  const res = await testGeminiApiKey(apiKey, model);
                  setTestResult(res);
                  setTesting(false);
                }}
              >
                {testing ? "Testando..." : "Testar Conexão"}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  saveGeminiSettings({ apiKey, model, enabled });
                  alert("Configurações salvas com sucesso!");
                }}
                style={{ background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)" }}
              >
                Salvar Chave
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Grid de Insights Automáticos */}
      <div>
        <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", color: "var(--text-primary)" }}>
          💡 Recomendações Automáticas da IA
        </h3>

        {loadingInsights ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontStyle: "italic" }}>
            Gerando diagnósticos e recomendações comerciais...
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
            {insights.map((insight) => (
              <div
                key={insight.id}
                style={{
                  background: "var(--surface-card, #ffffff)",
                  borderRadius: "16px",
                  padding: "16px 18px",
                  border: "1px solid var(--border-subtle, #e5e7eb)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "bold",
                        textTransform: "uppercase",
                        padding: "2px 8px",
                        borderRadius: "6px",
                        background: "rgba(124, 58, 237, 0.1)",
                        color: "#7c3aed",
                      }}
                    >
                      {insight.category}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "bold",
                        color: insight.impact === "ALTO" ? "#dc2626" : insight.impact === "MEDIO" ? "#d97706" : "#2563eb",
                      }}
                    >
                      Impacto {insight.impact}
                    </span>
                  </div>

                  <h4 style={{ margin: "0 0 6px 0", fontSize: "15px", color: "var(--text-primary)" }}>{insight.title}</h4>
                  <p style={{ margin: "0 0 10px 0", fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.4 }}>
                    {insight.description}
                  </p>
                </div>

                <div
                  style={{
                    background: "rgba(59, 130, 246, 0.05)",
                    borderLeft: "3px solid #2563eb",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "var(--text-primary)",
                  }}
                >
                  <strong>Ação Recomendada:</strong> {insight.recommendation}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chat Interativo Comercial Copilot */}
      <Card style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "16px", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
          💬 Conversar com a ZoeIA
        </h3>

        {/* Histórico de Mensagens */}
        <div
          style={{
            maxHeight: "360px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            padding: "14px",
            background: "var(--surface-neutral, #f9fafb)",
            borderRadius: "14px",
            border: "1px solid var(--border-subtle, #e5e7eb)",
          }}
        >
          {messages.map((m, idx) => (
            <div
              key={idx}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%",
                background: m.role === "user" ? "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)" : "var(--surface-card, #ffffff)",
                color: m.role === "user" ? "#ffffff" : "var(--text-primary)",
                padding: "12px 16px",
                borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                fontSize: "14px",
                lineHeight: 1.5,
                boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                border: m.role === "model" ? "1px solid var(--border-subtle, #e5e7eb)" : "none",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: "bold",
                  marginBottom: "4px",
                  opacity: 0.8,
                }}
              >
                {m.role === "user" ? "Você (Gerente)" : "✦ ZoeIA"}
              </div>
              {m.text}
            </div>
          ))}
          {busyChat && (
            <div
              style={{
                alignSelf: "flex-start",
                fontSize: "13px",
                color: "var(--text-muted)",
                fontStyle: "italic",
                padding: "8px",
              }}
            >
              ZoeIA digitando...
            </div>
          )}
        </div>

        {/* Formulário de Envio */}
        <form onSubmit={handleSendMessage} style={{ display: "flex", gap: "10px" }}>
          <Input
            placeholder="Faça uma pergunta sobre vendas, produtos, cupons ou metas..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={busyChat}
            style={{ flex: 1 }}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!inputMessage.trim() || busyChat}
            style={{ background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)", borderRadius: "9999px" }}
          >
            Enviar
          </Button>
        </form>
      </Card>
    </div>
  );
}
