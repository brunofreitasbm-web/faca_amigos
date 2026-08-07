import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Leitor de QR Code pela câmera do celular.
 *
 * Dois caminhos de decodificação, escolhidos automaticamente:
 *
 *   1. `BarcodeDetector` nativo (Chrome/Android, Edge). É o decodificador do
 *      próprio sistema, roda fora da thread da interface e não custa nada em
 *      bateria nem em travamento.
 *   2. jsQR sobre um canvas reduzido, quando o nativo não existe — que é o
 *      caso do Safari no iPhone, hoje sem `BarcodeDetector`. Sem essa
 *      segunda via, metade dos celulares simplesmente não leria.
 *
 * A câmera abre sozinha no `mount`: a saída é a operação com fila atrás, e
 * um botão "iniciar câmera" no meio do caminho custa um toque e uns dois
 * segundos em cada criança que vai embora.
 *
 * Requer contexto seguro (HTTPS ou localhost) — `getUserMedia` não existe em
 * http:// simples. Se faltar, a tela cai na digitação manual do código.
 */

// A varredura acontece numa imagem reduzida de propósito: 480px de lado maior
// é mais que suficiente para um QR versão 1 (21x21 módulos) que ocupa boa
// parte do quadro, e derruba o custo de cada quadro a ponto de o jsQR caber
// folgado no orçamento de 16ms mesmo em celular de entrada.
const SCAN_WIDTH = 480;
const SCAN_INTERVAL_MS = 120;

type DetectorLike = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };

interface QrScannerProps {
  /** Chamado a cada leitura nova. O componente já ignora repetições do mesmo código em sequência. */
  onScan: (value: string) => void;
  /** Enquanto true, a câmera continua ligada mas nenhuma leitura é reportada (ex.: modal de pagamento aberto). */
  paused?: boolean;
  height?: string;
}

export function QrScanner({ onScan, paused = false, height = "min(58vh, 420px)" }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<DetectorLike | null>(null);
  const lastValueRef = useRef<string>("");
  const lastAtRef = useRef<number>(0);
  const pausedRef = useRef(paused);
  const onScanRef = useRef(onScan);

  const [status, setStatus] = useState<"starting" | "scanning" | "denied" | "unsupported" | "error">("starting");
  const [engine, setEngine] = useState<"nativo" | "jsqr" | null>(null);

  // Guardar em ref evita reiniciar a câmera toda vez que o pai renderiza —
  // reabrir o stream a cada segundo é exatamente o "travamento" que a tela
  // precisa não ter.
  pausedRef.current = paused;
  onScanRef.current = onScan;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // playsInline: sem ele o iOS abre a câmera em tela cheia própria e
        // some com a interface de confirmação que vem logo abaixo.
        video.setAttribute("playsinline", "true");
        await video.play();

        const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => DetectorLike })
          .BarcodeDetector;
        if (Detector) {
          try {
            detectorRef.current = new Detector({ formats: ["qr_code"] });
            setEngine("nativo");
          } catch {
            detectorRef.current = null;
            setEngine("jsqr");
          }
        } else {
          setEngine("jsqr");
        }

        setStatus("scanning");
        timer = window.setInterval(tick, SCAN_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      }
    }

    async function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || pausedRef.current) return;

      const scale = SCAN_WIDTH / Math.max(video.videoWidth, 1);
      const w = SCAN_WIDTH;
      const h = Math.round(video.videoHeight * scale) || 360;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);

      let value: string | null = null;
      if (detectorRef.current) {
        try {
          const found = await detectorRef.current.detect(canvas);
          value = found[0]?.rawValue ?? null;
        } catch {
          // Alguns Android derrubam o detector nativo depois de um tempo em
          // segundo plano. Em vez de a tela parar de ler em silêncio, desce
          // para o jsQR e segue funcionando.
          detectorRef.current = null;
          setEngine("jsqr");
        }
      }
      if (!value) {
        const image = ctx.getImageData(0, 0, w, h);
        value = jsQR(image.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
      }
      if (!value) return;

      // A mesma pulseira fica no quadro por vários segundos depois de lida.
      // Sem esta trava, a tela dispararia a mesma saída dezenas de vezes.
      const now = Date.now();
      if (value === lastValueRef.current && now - lastAtRef.current < 4000) return;
      lastValueRef.current = value;
      lastAtRef.current = now;

      navigator.vibrate?.(60);
      onScanRef.current(value);
    }

    void start();
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: "20px",
        overflow: "hidden",
        background: "#0d0d0d",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover", opacity: paused ? 0.35 : 1, transition: "opacity 120ms" }}
      />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {status === "scanning" && (
        <>
          {/* Alvo: o operador aponta para dentro do quadrado, não para a tela inteira. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              width: "min(62%, 260px)",
              aspectRatio: "1",
              border: "3px solid rgba(255,255,255,0.9)",
              borderRadius: "24px",
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
            }}
          />
          <span
            style={{
              position: "absolute",
              bottom: "12px",
              fontSize: "13px",
              color: "#fff",
              background: "rgba(0,0,0,0.55)",
              padding: "6px 14px",
              borderRadius: "9999px",
            }}
          >
            {paused ? "Leitura pausada" : "Aponte para o QR da pulseira ou do recibo"}
            {engine === "jsqr" ? " · modo compatível" : ""}
          </span>
        </>
      )}

      {status === "starting" && <span style={{ color: "#fff", fontSize: "15px" }}>Abrindo a câmera…</span>}

      {status !== "scanning" && status !== "starting" && (
        <div style={{ color: "#fff", textAlign: "center", padding: "24px", fontSize: "14px", lineHeight: 1.5 }}>
          {status === "denied" && (
            <>
              <strong style={{ display: "block", fontSize: "16px", marginBottom: "8px" }}>Câmera bloqueada</strong>
              Libere o acesso à câmera para este site nas configurações do navegador e recarregue a página. Enquanto
              isso, use a digitação do código abaixo.
            </>
          )}
          {status === "unsupported" && (
            <>
              <strong style={{ display: "block", fontSize: "16px", marginBottom: "8px" }}>Câmera indisponível</strong>
              Este navegador só libera a câmera em endereços seguros (https). Use a digitação do código abaixo.
            </>
          )}
          {status === "error" && (
            <>
              <strong style={{ display: "block", fontSize: "16px", marginBottom: "8px" }}>Não foi possível abrir a câmera</strong>
              Outro aplicativo pode estar usando a câmera. Use a digitação do código abaixo.
            </>
          )}
        </div>
      )}
    </div>
  );
}
