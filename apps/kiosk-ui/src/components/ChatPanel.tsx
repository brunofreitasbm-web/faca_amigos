import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { XIcon } from "@facaamigos/ui";
import { chatAttachmentUrl } from "../api/useChat.js";
import {
  canSendChat,
  CHAT_BODY_MAX,
  ownMessageStatus,
  STATUS_LABEL,
  type ChatMessage,
} from "../lib/chat.js";

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function ChatImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    chatAttachmentUrl(path).then((u) => alive && setUrl(u)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);
  if (!url) return <div className="chat-img chat-img--loading">Carregando imagem…</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="chat-img" src={url} alt="Anexo da conversa" />
    </a>
  );
}

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  onSend: (body: string, file?: Blob) => Promise<void>;
  onRetry: (id: string) => void;
  onClose: () => void;
}

export function ChatPanel({ messages, loading, error, onSend, onRetry, onClose }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sempre na última mensagem.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Esc fecha o painel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!canSendChat(text, !!file)) return;
    const body = text;
    const attached = file;
    setText("");
    setFile(null);
    setSendError(null);
    if (fileRef.current) fileRef.current.value = "";
    try {
      await onSend(body, attached ?? undefined);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Não foi possível enviar.");
    }
  }

  let lastDay = "";
  return (
    <aside className="chat-panel" role="dialog" aria-label="Chat com o Owner">
      <header className="chat-panel__head">
        <strong>Chat com o Owner</strong>
        <button type="button" className="chat-panel__close" onClick={onClose} aria-label="Fechar chat">
          <XIcon />
        </button>
      </header>
      <p className="chat-panel__notice">As conversas ficam gravadas no sistema.</p>

      <div className="chat-panel__list" ref={listRef} aria-live="polite">
        {loading && messages.length === 0 && <p className="chat-panel__empty">Carregando…</p>}
        {error && <p className="chat-panel__error">Chat indisponível: {error}</p>}
        {!loading && !error && messages.length === 0 && (
          <p className="chat-panel__empty">Escreva abaixo para falar com o Owner sobre sistema, problemas ou avisos.</p>
        )}
        {messages.map((m) => {
          const day = dayLabel(m.created_at_ms);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = !m.from_owner;
          const status = mine ? ownMessageStatus(m) : null;
          return (
            <div key={m.id}>
              {showDay && <div className="chat-day">{day}</div>}
              <div className={`chat-msg ${mine ? "chat-msg--mine" : "chat-msg--owner"}${status === "FAILED" ? " chat-msg--failed" : ""}`}>
                {m.attachment_path && <ChatImage path={m.attachment_path} />}
                {m.body && <p className="chat-msg__body">{m.body}</p>}
                <span className="chat-msg__meta">
                  {hhmm(m.created_at_ms)}
                  {status && (
                    status === "FAILED" ? (
                      <button type="button" className="chat-msg__retry" onClick={() => onRetry(m.id)}>
                        {STATUS_LABEL.FAILED}
                      </button>
                    ) : (
                      <> · {STATUS_LABEL[status]}</>
                    )
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {sendError && <p className="chat-panel__error" role="alert">{sendError}</p>}
      {file && (
        <div className="chat-panel__attached">
          <span>📎 {file.name}</span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
          >
            remover
          </button>
        </div>
      )}
      <form
        className="chat-panel__composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button type="button" className="chat-panel__icon-btn" onClick={() => fileRef.current?.click()} aria-label="Anexar foto ou print" title="Anexar foto ou print">
          📎
        </button>
        <textarea
          value={text}
          maxLength={CHAT_BODY_MAX}
          rows={2}
          placeholder="Escreva sua mensagem…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button type="submit" className="chat-panel__send" disabled={!canSendChat(text, !!file)}>
          Enviar
        </button>
      </form>
    </aside>
  );
}
