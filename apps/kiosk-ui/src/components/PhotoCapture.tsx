import { useEffect, useRef, useState } from "react";
import { Button } from "@facaamigos/ui";

/**
 * Foto pela câmera do tablet — usada tanto para a criança (identificação
 * visual para o monitor no salão, nunca biometria) quanto para o envelope de
 * sangria no caixa. Estritamente webcam via getUserMedia: nunca `<input
 * type="file" capture>`, porque esse input dispara o app de câmera nativo do
 * sistema operacional — o que tira o navegador de primeiro plano e, em
 * tablets travados em modo kiosk, derruba a tela de volta pro launcher/home
 * em vez de voltar pro formulário. Sem input de arquivo, sem galeria: a foto
 * tem que ser tirada ali na hora (a criança na frente do balcão, o envelope
 * em cima do caixa), não escolhida de um álbum de outra pessoa.
 *
 * Câmera só liga quando o operador toca em "Tirar foto" — ao contrário do
 * QrScanner (que abre sozinha porque é o primeiro passo do fluxo), aqui é
 * opcional/sob demanda, então manter a câmera ligada por padrão seria pedir
 * permissão de vídeo para quem nem vai usar o recurso.
 */

const CAPTURE_WIDTH = 640;

type Status = "idle" | "starting" | "streaming" | "denied" | "unsupported" | "error" | "captured";

interface PhotoCaptureProps {
  /** Chamado com o blob capturado (JPEG), ou `null` quando a foto é removida. */
  onChange: (photo: Blob | null) => void;
  /** Texto do rótulo acima do botão/preview. */
  label?: string;
  /** Texto do botão que liga a câmera. */
  buttonLabel?: string;
  /** `alt` da miniatura após a captura. */
  previewAlt?: string;
  /** Exibe grade/moldura retangular de enquadramento sobre o vídeo para orientar o alinhamento de envelopes. */
  showEnvelopeGrid?: boolean;
}

export function PhotoCapture({
  onChange,
  label = "Foto da criança (opcional)",
  buttonLabel = "📷 Tirar foto pela câmera",
  previewAlt = "Foto capturada da criança",
  showEnvelopeGrid = false,
}: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => stopStream, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();
      setStatus("streaming");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
    }
  }

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const scale = CAPTURE_WIDTH / Math.max(video.videoWidth, 1);
    const w = CAPTURE_WIDTH;
    const h = Math.round(video.videoHeight * scale) || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        setPreviewUrl(URL.createObjectURL(blob));
        setStatus("captured");
        onChange(blob);
      },
      "image/jpeg",
      0.85,
    );
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    onChange(null);
    void openCamera();
  }

  function remove() {
    stopStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    onChange(null);
    setStatus("idle");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: "var(--weight-semibold)" as unknown as number, fontSize: "13px", color: "var(--text-secondary)" }}>
        {label}
      </span>

      {status === "idle" && (
        <Button variant="ghost" size="sm" onClick={openCamera} style={{ alignSelf: "flex-start" }}>
          {buttonLabel}
        </Button>
      )}

      {(status === "starting" || status === "streaming") && (
        <div
          style={{
            position: "relative",
            width: "min(100%, 320px)",
            aspectRatio: "4 / 3",
            borderRadius: "16px",
            overflow: "hidden",
            background: "#0d0d0d",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          {status === "starting" && <span style={{ position: "absolute", color: "#fff", fontSize: "13px" }}>Abrindo a câmera…</span>}

          {status === "streaming" && showEnvelopeGrid && (
            <>
              {/* Etiqueta superior de instrução */}
              <div
                style={{
                  position: "absolute",
                  top: "10px",
                  background: "rgba(0, 0, 0, 0.75)",
                  color: "#ffffff",
                  padding: "4px 12px",
                  borderRadius: "20px",
                  fontSize: "11px",
                  fontWeight: 600,
                  pointerEvents: "none",
                  zIndex: 2,
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  whiteSpace: "nowrap",
                }}
              >
                📐 Centralize o envelope no retângulo
              </div>

              {/* Guia retangular com sombra de foco e cantos destacados */}
              <div
                style={{
                  position: "absolute",
                  width: "76%",
                  height: "56%",
                  boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.38)",
                  border: "1.5px dashed rgba(255, 255, 255, 0.7)",
                  borderRadius: "8px",
                  pointerEvents: "none",
                  zIndex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* Cantos destacados estilo scanner em tom ciano/turquesa */}
                <div style={{ position: "absolute", top: "-2px", left: "-2px", width: "16px", height: "16px", borderTop: "3px solid #06b6d4", borderLeft: "3px solid #06b6d4", borderTopLeftRadius: "6px" }} />
                <div style={{ position: "absolute", top: "-2px", right: "-2px", width: "16px", height: "16px", borderTop: "3px solid #06b6d4", borderRight: "3px solid #06b6d4", borderTopRightRadius: "6px" }} />
                <div style={{ position: "absolute", bottom: "-2px", left: "-2px", width: "16px", height: "16px", borderBottom: "3px solid #06b6d4", borderLeft: "3px solid #06b6d4", borderBottomLeftRadius: "6px" }} />
                <div style={{ position: "absolute", bottom: "-2px", right: "-2px", width: "16px", height: "16px", borderBottom: "3px solid #06b6d4", borderRight: "3px solid #06b6d4", borderBottomRightRadius: "6px" }} />
              </div>
            </>
          )}

          {status === "streaming" && (
            <button
              type="button"
              onClick={capture}
              aria-label="Capturar foto"
              title="Capturar foto"
              style={{
                position: "absolute",
                bottom: "14px",
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                border: "3px solid #fff",
                background: "var(--gradient-ring)",
                cursor: "pointer",
                zIndex: 3,
              }}
            />
          )}
        </div>
      )}

      {status === "streaming" && (
        <Button variant="ghost" size="sm" onClick={() => { stopStream(); setStatus("idle"); }} style={{ alignSelf: "flex-start" }}>
          Cancelar
        </Button>
      )}

      {status === "captured" && previewUrl && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <img
            src={previewUrl}
            alt={previewAlt}
            style={{ width: "96px", height: "96px", objectFit: "cover", borderRadius: "14px", border: "2px solid var(--color-teal)" }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="ghost" size="sm" onClick={retake}>
              🔄 Repetir
            </Button>
            <Button variant="ghost" size="sm" onClick={remove}>
              ✕ Remover
            </Button>
          </div>
        </div>
      )}

      {status === "denied" && (
        <span style={{ fontSize: "12px", color: "var(--color-error-text)" }}>
          Câmera bloqueada — libere o acesso à câmera para este site nas configurações do navegador e tente de novo. A foto é
          opcional; você pode continuar o cadastro sem ela.
        </span>
      )}
      {status === "unsupported" && (
        <span style={{ fontSize: "12px", color: "var(--color-error-text)" }}>
          Este navegador só libera a câmera em endereços seguros (https). A foto é opcional; você pode continuar sem ela.
        </span>
      )}
      {status === "error" && (
        <span style={{ fontSize: "12px", color: "var(--color-error-text)" }}>
          Não foi possível abrir a câmera — outro aplicativo pode estar usando-a.{" "}
          <button
            type="button"
            onClick={openCamera}
            style={{ background: "none", border: "none", padding: 0, color: "var(--color-primary-hover)", fontWeight: "bold", cursor: "pointer", font: "inherit" }}
          >
            Tentar de novo
          </button>
        </span>
      )}

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
