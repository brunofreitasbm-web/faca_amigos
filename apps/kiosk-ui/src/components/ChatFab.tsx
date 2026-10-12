import { useCallback, useState } from "react";
import { useChat } from "../api/useChat.js";
import { useAuth } from "../auth/AuthContext.js";
import { useAppState } from "../state/AppState.js";
import { buildChatContext } from "../lib/chat.js";
import { ChatPanel } from "./ChatPanel.js";

/**
 * Botão flutuante do chat com os donos. Fica no canto DIREITO, acima dos botões redondos de PDV e Entrada do Painel
 * (ver o `bottom` em `.chat-fab` no app.css). É grande e traz o texto escrito, para o operador não confundir.
 */
function Bubble() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6a.6.6 0 0 1-1-.46V16H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * O painel abre POR CIMA da tela atual (sem navegar), então o operador volta ao ponto
 * exato em que estava. Todos com `chat.usar` veem o botão, inclusive os admins do chat (fa_chat_admins):
 * para eles é a conversa deles, que chega ao grupo do Telegram como a de qualquer colaborador.
 */
export function ChatFab({ screen }: { screen: string }) {
  const { can } = useAuth();
  const { employee, unit } = useAppState();
  const enabled = !!employee && can("chat.usar");
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
          className="chat-fab"
          onClick={() => setOpen(true)}
          aria-label={chat.unread > 0 ? `Chat com os donos: ${chat.unread} mensagem(ns) nova(s)` : "Chat com os donos"}
          title="Falar com os donos (sistema, problemas e avisos)"
        >
          <Bubble />
          <span className="chat-fab__label">CHAT</span>
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
