import { useRef } from "react";
import type { TouchEvent } from "react";

// Gesto de navegação por toque: arrastar o conteúdo para os lados troca de
// módulo (Entrada → Painel → PDV...), como um carrossel — no celular é mais
// rápido que caçar o botão certo na barra retrátil. Só dispara com um
// arraste majoritariamente horizontal e rápido, para não confundir com
// rolagem vertical da tela nem com o arraste horizontal de uma tabela larga
// (relatórios) que já rola por conta própria.
const MIN_DISTANCE_PX = 60;
const MAX_DURATION_MS = 600;
const MIN_HORIZONTAL_RATIO = 1.5;

interface TouchPoint {
  x: number;
  y: number;
  time: number;
}

function isInsideHorizontalScroller(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  for (let depth = 0; el && depth < 8; depth += 1) {
    const style = window.getComputedStyle(el);
    const scrollsX = style.overflowX === "auto" || style.overflowX === "scroll";
    if (scrollsX && el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}

export function useSwipeNavigation(onSwipeLeft: () => void, onSwipeRight: () => void) {
  const startRef = useRef<TouchPoint | null>(null);
  const ignoreRef = useRef(false);

  function onTouchStart(e: TouchEvent) {
    const touch = e.touches[0];
    if (!touch) return;
    startRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    ignoreRef.current = isInsideHorizontalScroller(e.target);
  }

  function onTouchEnd(e: TouchEvent) {
    const start = startRef.current;
    startRef.current = null;
    if (!start || ignoreRef.current) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const elapsed = Date.now() - start.time;

    if (elapsed > MAX_DURATION_MS) return;
    if (Math.abs(dx) < MIN_DISTANCE_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * MIN_HORIZONTAL_RATIO) return;

    if (dx < 0) onSwipeLeft();
    else onSwipeRight();
  }

  return { onTouchStart, onTouchEnd };
}
