import { useCallback, useEffect, useRef, useState } from "react";
import { captureFrameAsJpeg, extractFaceDescriptor, loadFaceModels } from "../lib/faceRecognition.js";

interface UseFaceCaptureState {
  ready: boolean;
  starting: boolean;
  error: string | null;
}

/**
 * Liga a webcam num <video> (via ref) e carrega os modelos de reconhecimento
 * facial em paralelo. `capture()` tira o frame atual, extrai o descriptor e
 * devolve os dois — quem chama decide se compara contra um descriptor
 * cadastrado (bater ponto) ou só guarda o novo (cadastro de rosto).
 *
 * Sempre chama `stop()` ao desmontar/fechar — a câmera do tablet fica presa
 * (luz acesa, stream ocupado) até isso acontecer.
 */
export function useFaceCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<UseFaceCaptureState>({ ready: false, starting: false, error: null });

  const attachStreamToVideo = useCallback((video: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.play().catch((err) => {
        console.warn("Falha no video.play():", err);
      });
    }
  }, []);

  const start = useCallback(async () => {
    setState({ ready: false, starting: true, error: null });
    try {
      await loadFaceModels();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      } catch {
        // Fallback genérico caso facingMode restritivo falhe
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;

      if (videoRef.current) {
        attachStreamToVideo(videoRef.current, stream);
      }

      setState({ ready: true, starting: false, error: null });
    } catch (err) {
      let message = "Não foi possível acessar a câmera.";
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError" || err.name === "SecurityError") {
          message = "Acesso à câmera bloqueado. Libere a permissão no navegador ou sistema.";
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          message = "Nenhuma câmera foi encontrada neste dispositivo.";
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          message = "A câmera já está sendo usada por outro aplicativo ou processo.";
        }
      } else if (err instanceof Error) {
        message = err.message;
      }
      setState({
        ready: false,
        starting: false,
        error: message,
      });
    }
  }, [attachStreamToVideo]);

  // Garante a vinculação do stream ao elemento <video> assim que ele for renderizado/montado no DOM
  useEffect(() => {
    if (state.ready && videoRef.current && streamRef.current) {
      attachStreamToVideo(videoRef.current, streamRef.current);
    }
  }, [state.ready, attachStreamToVideo]);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setState({ ready: false, starting: false, error: null });
  }, []);

  useEffect(() => () => stop(), [stop]);

  const capture = useCallback(async (): Promise<{ descriptor: number[]; photo: Blob } | null> => {
    if (!videoRef.current || videoRef.current.readyState < 2) return null;
    const [descriptor, photo] = await Promise.all([
      extractFaceDescriptor(videoRef.current),
      captureFrameAsJpeg(videoRef.current),
    ]);
    if (!descriptor || !photo) return null;
    return { descriptor, photo };
  }, []);

  return { videoRef, ...state, start, stop, capture };
}

