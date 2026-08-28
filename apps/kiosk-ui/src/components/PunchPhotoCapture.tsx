import { HelpText } from "@facaamigos/ui";
import type { useFaceCapture } from "../hooks/useFaceCapture.js";
import type { useGeolocation } from "../hooks/useGeolocation.js";

export interface PunchPhotoCaptureProps {
  faceCapture: ReturnType<typeof useFaceCapture>;
  geolocation: ReturnType<typeof useGeolocation>;
  /** null quando a unidade não tem geofence configurado — GPS vira informativo, não bloqueante. */
  geofenceRadiusM: number | null;
  /** Status do reconhecimento rápido (opcional): scanning, detected, success, fail */
  scanState?: "idle" | "scanning" | "detected" | "success" | "fail";
  detectedName?: string | null;
}

/**
 * Preview da câmera + status do GPS, mostrado no PontoScreen enquanto o
 * colaborador decide qual marcação bater. Exibe overlay visual de alinhamento
 * facial para facilitar e acelerar a identificação biométrica.
 */
export function PunchPhotoCapture({
  faceCapture,
  geolocation,
  geofenceRadiusM,
  scanState = "idle",
  detectedName,
}: PunchPhotoCaptureProps) {
  const borderColor =
    scanState === "success"
      ? "var(--color-teal, #10b981)"
      : scanState === "detected"
        ? "var(--color-warning, #f59e0b)"
        : scanState === "fail"
          ? "var(--color-error, #ef4444)"
          : "rgba(255, 255, 255, 0.4)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "240px",
          borderRadius: "var(--radius-lg, 16px)",
          overflow: "hidden",
          background: "#000",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        }}
      >
        <video
          ref={faceCapture.videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
          }}
        />

        {/* Guia Oval de Alinhamento Facial (Escaneamento Biométrico) */}
        {faceCapture.ready && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "140px",
              height: "180px",
              borderRadius: "50%",
              border: `3px dashed ${borderColor}`,
              boxShadow: `0 0 20px ${borderColor}`,
              transition: "all 0.3s ease",
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {scanState === "scanning" && (
              <div
                style={{
                  width: "100%",
                  height: "2px",
                  background: "linear-gradient(90deg, transparent, #10b981, transparent)",
                  animation: "scanPulse 1.8s infinite ease-in-out",
                }}
              />
            )}
          </div>
        )}

        {/* Badge de status no topo da câmera */}
        {scanState !== "idle" && (
          <div
            style={{
              position: "absolute",
              top: "12px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0, 0, 0, 0.75)",
              backdropFilter: "blur(8px)",
              color: "#fff",
              padding: "4px 14px",
              borderRadius: "9999px",
              fontSize: "13px",
              fontWeight: "600",
              letterSpacing: "0.3px",
              zIndex: 2,
              border: `1px solid ${borderColor}`,
            }}
          >
            {scanState === "scanning" && "🔍 Posicione o rosto na moldura…"}
            {scanState === "detected" && `👤 Rosto identificado: ${detectedName ?? "Processando…"}`}
            {scanState === "success" && `✅ Sucesso! Ponto de ${detectedName} registrado`}
            {scanState === "fail" && "⚠️ Rosto não cadastrado ou não conferido"}
          </div>
        )}
      </div>

      {faceCapture.starting && <HelpText>Ligando a câmera…</HelpText>}
      {faceCapture.error && <p style={{ color: "var(--color-error-text)", margin: 0 }}>{faceCapture.error}</p>}
      {faceCapture.ready && !scanState && (
        <HelpText icon="📷">Centralize seu rosto e toque na marcação abaixo.</HelpText>
      )}
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

