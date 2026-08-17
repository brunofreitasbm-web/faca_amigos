import { HelpText } from "@facaamigos/ui";
import type { useFaceCapture } from "../hooks/useFaceCapture.js";
import type { useGeolocation } from "../hooks/useGeolocation.js";

export interface PunchPhotoCaptureProps {
  faceCapture: ReturnType<typeof useFaceCapture>;
  geolocation: ReturnType<typeof useGeolocation>;
  /** null quando a unidade não tem geofence configurado — GPS vira informativo, não bloqueante. */
  geofenceRadiusM: number | null;
}

/**
 * Preview da câmera + status do GPS, mostrado no PontoScreen enquanto o
 * colaborador decide qual marcação bater. Só exibe estado — a captura em si
 * (tirar o frame, extrair descriptor, pedir localização) acontece no
 * `bater()` do PontoScreen no instante do clique, não aqui, porque cada
 * marcação de ponto precisa da SUA PRÓPRIA foto/localização, não uma
 * capturada uma vez no início da sessão do terminal.
 */
export function PunchPhotoCapture({ faceCapture, geolocation, geofenceRadiusM }: PunchPhotoCaptureProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <video
        ref={faceCapture.videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          maxHeight: "220px",
          objectFit: "cover",
          borderRadius: "var(--radius-lg, 16px)",
          background: "#000",
          transform: "scaleX(-1)",
        }}
      />
      {faceCapture.starting && <HelpText>Ligando a câmera…</HelpText>}
      {faceCapture.error && <p style={{ color: "var(--color-error-text)", margin: 0 }}>{faceCapture.error}</p>}
      {faceCapture.ready && <HelpText icon="📷">Centralize seu rosto e toque na marcação abaixo.</HelpText>}
      {geofenceRadiusM !== null && (
        <HelpText icon="📍">
          {geolocation.loading
            ? "Obtendo localização…"
            : geolocation.error
              ? geolocation.error
              : geolocation.position
                ? `Localização obtida (precisão ~${Math.round(geolocation.position.accuracy)}m).`
                : "Esta unidade exige localização para bater o ponto."}
        </HelpText>
      )}
    </div>
  );
}
