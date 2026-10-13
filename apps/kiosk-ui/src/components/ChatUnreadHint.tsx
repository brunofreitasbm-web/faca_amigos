import { useChatUnreadHint } from "../api/useChat.js";

/** Aviso genérico na tela de PIN: sem nome, sem texto. Quem tem mensagem pendente entra para ler. */
export function ChatUnreadHint() {
  const n = useChatUnreadHint();
  if (n <= 0) return null;
  return (
    <div className="chat-hint" role="status">
      <span className="chat-hint__dot" aria-hidden="true" />
      Há mensagens novas dos donos no chat. Entre com seu PIN para ler.
    </div>
  );
}
