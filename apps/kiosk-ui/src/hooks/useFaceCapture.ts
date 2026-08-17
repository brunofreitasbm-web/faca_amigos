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

  const start = useCallback(async () => {
    setState({ ready: false, starting: true, error: null });
    try {
      await loadFaceModels();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState({ ready: true, starting: false, error: null });
    } catch (err) {
      setState({
        ready: false,
        starting: false,
        error: err instanceof Error ? err.message : "Não foi possível acessar a câmera.",
      });
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState({ ready: false, starting: false, error: null });
  }, []);

  useEffect(() => () => stop(), [stop]);

  const capture = useCallback(async (): Promise<{ descriptor: number[]; photo: Blob } | null> => {
    if (!videoRef.current) return null;
    const [descriptor, photo] = await Promise.all([
      extractFaceDescriptor(videoRef.current),
      captureFrameAsJpeg(videoRef.current),
    ]);
    if (!descriptor || !photo) return null;
    return { descriptor, photo };
  }, []);

  return { videoRef, ...state, start, stop, capture };
}
