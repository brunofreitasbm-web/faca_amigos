import { useEffect, useRef, useState } from "react";
import type { SessionPhase } from "./client.js";

export interface TickSession {
  id: string;
  remainingMs: number;
  phase: SessionPhase;
  billedFractionIndex: number;
}

export interface TickFrame {
  serverNowMs: number;
  sessions: TickSession[];
}

/**
 * Canal de tick (seção 5.5 do plano): o painel nunca calcula tempo
 * pelo próprio relógio, só reage aos frames do servidor. Reconecta
 * sozinho se a conexão cair (ex.: servidor reiniciou).
 */
export function useTick(unitId: string | null): TickFrame | null {
  const [frame, setFrame] = useState<TickFrame | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!unitId) return;
    let closedByEffect = false;
    let socket: WebSocket;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${window.location.host}/ws/units/${unitId}`);
      socket.onmessage = (event: MessageEvent<string>) => {
        setFrame(JSON.parse(event.data) as TickFrame);
      };
      socket.onclose = () => {
        if (!closedByEffect) retryRef.current = setTimeout(connect, 2000);
      };
    }
    connect();

    return () => {
      closedByEffect = true;
      clearTimeout(retryRef.current);
      socket.close();
    };
  }, [unitId]);

  return frame;
}
