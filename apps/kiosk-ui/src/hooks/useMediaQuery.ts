import { useSyncExternalStore } from "react";

/**
 * Resultado de uma media query, reativo a mudanças (redimensionar a janela,
 * plugar um mouse). Sem `window.matchMedia` (testes, SSR) devolve `false`.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches,
    () => false,
  );
}

/** Tela larga com mouse — o PC do balcão e o Gerencial no escritório. */
export const DESKTOP_POINTER_QUERY = "(min-width: 1100px) and (pointer: fine)";
