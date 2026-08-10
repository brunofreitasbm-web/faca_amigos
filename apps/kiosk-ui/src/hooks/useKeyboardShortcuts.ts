import { useEffect } from "react";

interface KeyboardShortcutsOptions {
  onGoBack?: () => void;
  onEscape?: () => void;
  onSave?: () => void;
  onSearch?: () => void;
  enabled?: boolean;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}

/**
 * Hook global para atalhos de teclado e gestos de produtividade.
 * - Backspace / Alt+Seta Esquerda: Volta para a tela/aba anterior no histórico (se fora de inputs)
 * - ESC: Fecha modais / janelas sobrepostas ativas
 * - Ctrl+S / Cmd+S: Dispara o salvamento do formulário ou ação principal
 * - /: Foca automaticamente no campo de busca da tela atual
 */
export function useKeyboardShortcuts({
  onGoBack,
  onEscape,
  onSave,
  onSearch,
  enabled = true,
}: KeyboardShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const isEditable = isEditableElement(e.target);

      // Ctrl+S / Cmd+S: Salvar formulário ou ação principal (mesmo dentro de input)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        if (onSave) {
          e.preventDefault();
          onSave();
        }
        return;
      }

      // Escape: Fechar modais / popups / drawers
      if (e.key === "Escape") {
        if (onEscape) {
          e.preventDefault();
          onEscape();
        }
        return;
      }

      // Atalhos ignorados quando o usuário estiver editando texto
      if (isEditable) return;

      // Backspace ou Alt + Seta Esquerda: Voltar para tela/módulo anterior
      if (e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) {
        if (onGoBack) {
          e.preventDefault();
          onGoBack();
        }
        return;
      }

      // Tecla /: Focar no campo de busca
      if (e.key === "/") {
        e.preventDefault();
        if (onSearch) {
          onSearch();
        } else {
          const searchInput = document.querySelector<HTMLInputElement>(
            "input[data-search-input], input[type='search'], input[placeholder*='Buscar'], input[placeholder*='buscar'], input[placeholder*='Pesquisar']"
          );
          if (searchInput) {
            searchInput.focus();
            searchInput.select?.();
          }
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onGoBack, onEscape, onSave, onSearch, enabled]);
}
