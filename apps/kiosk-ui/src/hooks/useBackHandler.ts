import { useEffect, useRef } from "react";

/**
 * Liga o botão/gesto "voltar" do navegador (Android, PWA, iOS) à navegação
 * interna do app. Sem isto, voltar sai do site mesmo estando numa subtela.
 *
 * `depth` é quantos passos de "voltar" internos existem agora (0 = raiz, deixa
 * o navegador sair). Para cada nível, empilhamos uma entrada no histórico; ao
 * receber popstate, chamamos `onBack` do dono da entrada mais recente.
 * Vários hooks coexistem (app, casca mobile, gerencial): a ordem de empilhar
 * é a ordem de desfazer.
 */
type Owner = { onBack: () => void; pushed: number; sync: () => void };

const tokens: Owner[] = []; // um item por entrada empilhada, na ordem do histórico
let suppress = 0; // popstates provocados por nós (history.go) que devem ser ignorados
let listening = false;

function onPopState() {
  if (suppress > 0) {
    suppress--;
    return;
  }
  const owner = tokens.pop();
  if (!owner) return;
  owner.pushed--;
  owner.onBack();
  // Se o onBack não reduziu o depth, o efeito não roda; ressincroniza a pilha.
  setTimeout(owner.sync, 0);
}

function ensureListener() {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", onPopState);
}

export function useBackHandler(depth: number, onBack: () => void): void {
  const depthRef = useRef(depth);
  const onBackRef = useRef(onBack);
  depthRef.current = depth;
  onBackRef.current = onBack;

  const ownerRef = useRef<Owner | null>(null);
  if (!ownerRef.current) {
    const owner: Owner = {
      pushed: 0,
      onBack: () => onBackRef.current(),
      sync: () => {
        const diff = depthRef.current - owner.pushed;
        if (diff > 0) {
          for (let i = 0; i < diff; i++) {
            history.pushState({ faBack: true }, "");
            tokens.push(owner);
          }
          owner.pushed += diff;
        } else if (diff < 0) {
          // O app saiu da subtela por conta própria (botão na tela): remove
          // as entradas sobrando sem disparar um "voltar" lógico.
          for (let i = 0; i < -diff; i++) {
            const idx = tokens.lastIndexOf(owner);
            if (idx !== -1) tokens.splice(idx, 1);
          }
          owner.pushed += diff;
          suppress++;
          history.go(diff);
        }
      },
    };
    ownerRef.current = owner;
  }

  useEffect(() => {
    ensureListener();
    ownerRef.current?.sync();
  }, [depth]);

  useEffect(() => {
    const owner = ownerRef.current;
    return () => {
      if (!owner) return;
      depthRef.current = 0;
      owner.sync();
    };
  }, []);
}
