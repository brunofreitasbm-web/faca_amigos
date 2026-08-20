import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "fa.mobileShell";

/**
 * Largura em que a casca mobile assume o lugar da casca de balcão.
 *
 * 640px e não os 768px do app.css de propósito: 768 é a régua do
 * "cabeçalho não cabe mais numa linha" e pega tablet em retrato, onde as
 * telas completas ainda funcionam bem e têm MAIS recurso (PDV, fiscal,
 * relatórios). A casca mobile é para o aparelho que o colaborador leva no
 * bolso, andando pela pista — não para o tablet apoiado no balcão.
 */
const PHONE_MAX_WIDTH = 640;

function phoneWidth(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches;
}

export interface MobileShellState {
  /** A casca mobile deve ser renderizada agora. */
  active: boolean;
  /** O aparelho tem largura de celular (independente da preferência). */
  isPhone: boolean;
  /** Sai para as telas completas neste aparelho, e lembra da escolha. */
  useFullVersion: () => void;
  /** Volta para a casca mobile. */
  useMobileVersion: () => void;
}

/**
 * Decide entre a casca mobile e as telas completas.
 *
 * A preferência é por aparelho (localStorage), não por colaborador: quem
 * define isto é o tamanho do vidro na mão, e o mesmo celular é usado por
 * quem entra no turno seguinte. Trocar de colaborador não deve ressuscitar
 * a escolha de outra pessoa.
 */
export function useMobileShell(): MobileShellState {
  const [isPhone, setIsPhone] = useState(phoneWidth);
  const [optedOut, setOptedOut] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "off";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);
    const onChange = () => setIsPhone(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const persist = useCallback((value: "off" | null) => {
    try {
      if (value === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Modo privado / storage cheio: a escolha vale só para esta aba.
    }
  }, []);

  const useFullVersion = useCallback(() => {
    persist("off");
    setOptedOut(true);
  }, [persist]);

  const useMobileVersion = useCallback(() => {
    persist(null);
    setOptedOut(false);
  }, [persist]);

  return { active: isPhone && !optedOut, isPhone, useFullVersion, useMobileVersion };
}
