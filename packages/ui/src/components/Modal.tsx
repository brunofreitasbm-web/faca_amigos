import { useEffect, useId, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "./Button.js";
import { XIcon } from "../icons/index.js";

export interface ModalProps {
  /** Título do diálogo — também vira o rótulo acessível (aria-labelledby). */
  title?: ReactNode;
  /**
   * Nome acessível quando o conteúdo já traz seu próprio `<h1>` visível
   * (ex.: um overlay que só embrulha uma tela inteira) — evita duplicar
   * o título na tela E no cabeçalho do diálogo.
   */
  ariaLabel?: string;
  children: ReactNode;
  onClose: () => void;
  /** Clique no fundo escurecido fecha. Default true. */
  closeOnBackdrop?: boolean;
  maxWidth?: string;
  bodyStyle?: CSSProperties;
  /** z-index do overlay — para empilhar corretamente quando um modal abre outro. */
  zIndex?: number;
  /** Padding do painel do diálogo. Default "24px" — zere quando o conteúdo já tem o próprio padding (ex. uma tela inteira embrulhada). */
  padding?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal compartilhado.
 *
 * Existiam 8 implementações desse padrão no produto (CheckoutModal,
 * WristbandPrintModal, ReceiptPrintModal, SystemStatusOverlay,
 * ConfirmContext, e os dois overlays de Entrada/PDV do Painel), cada uma
 * um `<div>` de fundo escurecido com um `onClick` pra fechar — nenhuma
 * com `role="dialog"`, foco preso, fechamento por Escape ou devolução de
 * foco pra quem abriu. Resultado prático: um usuário de teclado que
 * entrava num desses diálogos ficava sem conseguir sair dele, e um
 * usuário de leitor de tela não recebia aviso nenhum de que um diálogo
 * tinha aberto por cima da tela.
 */
export function Modal({
  title,
  ariaLabel,
  children,
  onClose,
  closeOnBackdrop = true,
  maxWidth = "480px",
  bodyStyle,
  zIndex = 200,
  padding = "24px",
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    // Foca o próprio diálogo (não um botão específico dentro dele) — o
    // conteúdo varia demais entre os 8 usos pra supor qual é "o primeiro
    // campo certo"; o dialog com tabIndex=-1 é o alvo seguro e genérico.
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      // Foco preso: Tab/Shift+Tab nunca escapam do diálogo pro conteúdo
      // por trás, que continua na árvore (só coberto pelo scrim).
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Devolve o foco a quem abriu o diálogo — sem isso o foco cai pro
      // <body> a cada fechamento, e um usuário de teclado perde o lugar
      // onde estava toda vez que fecha um modal.
      previousFocus.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflowY: "auto",
        padding: "24px",
      }}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-card)",
          borderRadius: "var(--radius-card)",
          maxWidth,
          width: "100%",
          height: "fit-content",
          position: "relative",
          boxShadow: "var(--shadow-lg)",
          padding,
          outline: "none",
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Fechar"
          title="Fechar"
          style={{ position: "absolute", top: "12px", right: "12px", zIndex: 1, fontSize: "18px" }}
        >
          <XIcon />
        </Button>
        {title && (
          <h2 id={titleId} style={{ marginTop: 0, paddingRight: "32px" }}>
            {title}
          </h2>
        )}
        <div style={bodyStyle}>{children}</div>
      </div>
    </div>
  );
}
