import { useCallback, useState } from "react";
import { useChat } from "../api/useChat.js";
import { useAuth } from "../auth/AuthContext.js";
import { useAppState } from "../state/AppState.js";
import { buildChatContext } from "../lib/chat.js";
import { ChatPanel } from "./ChatPanel.js";

/**
 * Botão flutuante do chat com o Owner. Fica na borda ESQUERDA de propósito: o canto
 * inferior direito já tem o resumo do Owner e o botão amarelo de Saída do Painel.
 * Para trocar de lado basta mudar esta constante (e o `.chat-fab--right` no app.css).
 */
const CHAT_FAB_SIDE: "left" | "right" = "left";

function Bubble() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6a.6.6 0 0 1-1-.46V16H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * O painel abre POR CIMA da tela atual (sem navegar), então o operador volta ao ponto
 * exato em que estava. O Owner (chat.admin) responde pelo Telegram e não vê o botão.
 */
export function ChatFab({ screen }: { screen: string }) {
  const { can } = useAuth();
  const { employee, unit } = useAppState();
  const enabled = !!employee && can("chat.usar") && !can("chat.admin");
  const [open, setOpen] = useState(false);

  const getContext = useCallback(
    () =>
      buildChatContext({
        screen,
        unitId: unit?.id ?? null,
        appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined,
        userAgent: navigator.userAgent,
      }),
    [screen, unit?.id],
  );

  const chat = useChat({ enabled, panelOpen: open, getContext });
  if (!enabled) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          className={`chat-fab chat-fab--${CHAT_FAB_SIDE}${chat.unread > 0 ? " chat-fab--unread" : ""}`}
          onClick={() => setOpen(true)}
          aria-label={chat.unread > 0 ? `Chat com o Owner: ${chat.unread} mensagem(ns) nova(s)` : "Chat com o Owner"}
          title="Chat com o Owner"
        >
          <Bubble />
          {chat.unread > 0 && <span className="chat-fab__badge">{chat.unread > 9 ? "9+" : chat.unread}</span>}
        </button>
      )}
      {open && (
        <ChatPanel
          messages={chat.messages}
          loading={chat.loading}
          error={chat.error}
          onSend={(body, file) => chat.send(body, file, employee?.id)}
          onRetry={(id) => void chat.retry(id)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
