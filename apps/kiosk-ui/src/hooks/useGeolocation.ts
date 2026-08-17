import { useCallback, useState } from "react";

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

interface UseGeolocationState {
  position: GeoPosition | null;
  error: string | null;
  loading: boolean;
}

/**
 * Pede a localização atual sob demanda (não fica escutando em background —
 * o quiosque só precisa de UM ponto no instante de bater o ponto). O
 * resultado aqui é só para mostrar um aviso amigável antes de enviar; quem
 * de fato barra a marcação fora do raio é o servidor (ver `lib/geo.ts`).
 */
export function useGeolocation() {
  const [state, setState] = useState<UseGeolocationState>({ position: null, error: null, loading: false });

  const request = useCallback((): Promise<GeoPosition | null> => {
    if (!("geolocation" in navigator)) {
      setState({ position: null, error: "Este dispositivo não tem GPS/geolocalização disponível.", loading: false });
      return Promise.resolve(null);
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const position: GeoPosition = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
          setState({ position, error: null, loading: false });
          resolve(position);
        },
        (err) => {
          const message =
            err.code === err.PERMISSION_DENIED
              ? "Permissão de localização negada — libere o GPS para este site nas configurações do dispositivo."
              : "Não foi possível obter a localização atual.";
          setState({ position: null, error: message, loading: false });
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    });
  }, []);

  return { ...state, request };
}
