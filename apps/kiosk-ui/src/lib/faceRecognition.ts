import * as faceapi from "@vladmandic/face-api";

// Modelos self-hosted em public/models (não CDN) — o quiosque precisa
// funcionar mesmo com a internet do local instável/fora do ar, e um
// registro de ponto (valor legal, Portaria MTP 671/2021) não pode depender
// de um CDN externo responder a tempo. Ver README de apps/kiosk-ui para o
// passo de baixar os pesos (~6MB) antes do primeiro build.
const MODEL_URL = "/models";

// Limiar flexível para maior tolerância e rapidez na captação: abaixo de 0.55
// a distância euclidiana entre os descriptors é considerada "mesma pessoa".
const MATCH_THRESHOLD = 0.55;

let modelsLoadedPromise: Promise<void> | null = null;

/** Carrega os modelos uma única vez por sessão da SPA — chamadas repetidas reaproveitam a mesma promise. */
export function loadFaceModels(): Promise<void> {
  if (!modelsLoadedPromise) {
    modelsLoadedPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).then(() => undefined);
  }
  return modelsLoadedPromise;
}

/** Extrai o descriptor facial (128 floats) do frame atual com configurações de ultra-velocidade (inputSize 160, scoreThreshold 0.3). */
export async function extractFaceDescriptor(video: HTMLVideoElement): Promise<number[] | null> {
  await loadFaceModels();
  // Configurações otimizadas para captação ultra-rápida e menor exigência biométrica
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 160, // 160px processa ~4x-6x mais rápido que o padrão (416px)
    scoreThreshold: 0.3, // Menor exigência de pontuação para detecção imediata
  });

  const detection = await faceapi
    .detectSingleFace(video, options)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  return Array.from(detection.descriptor);
}

/** Distância euclidiana entre dois descriptors — quanto menor, mais parecido. */
export function faceDistance(a: number[], b: number[]): number {
  return faceapi.euclideanDistance(a, b);
}

/** true se os dois descriptors são, dentro do limiar aceito, a mesma pessoa. */
export function isSameFace(a: number[], b: number[]): boolean {
  return faceDistance(a, b) <= MATCH_THRESHOLD;
}

/** Congela o frame atual do <video> como um JPEG (Blob) — para guardar como evidência da marcação ou do cadastro. */
export function captureFrameAsJpeg(video: HTMLVideoElement, quality = 0.8): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export interface FaceCandidate {
  id: string;
  descriptor: number[];
}

/** Encontra a melhor correspondência para um descriptor dentre uma lista de candidatos. Retorna o candidato ou null se acima do limiar. */
export function findBestFaceMatch<T extends FaceCandidate>(descriptor: number[], candidates: T[]): { match: T; distance: number } | null {
  let bestMatch: T | null = null;
  let minDistance = Infinity;

  for (const candidate of candidates) {
    if (!candidate.descriptor || candidate.descriptor.length === 0) continue;
    const dist = faceDistance(descriptor, candidate.descriptor);
    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = candidate;
    }
  }

  if (bestMatch && minDistance <= MATCH_THRESHOLD) {
    return { match: bestMatch, distance: minDistance };
  }
  return null;
}

/** Emite sinal sonoro suave de sucesso via Web Audio API. */
export function playSuccessChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(783.99, now + 0.1);
    gain2.gain.setValueAtTime(0.2, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.35);
  } catch {
    // Ignora se AudioContext não puder ser iniciado sem gesto prévio do usuário
  }
}

