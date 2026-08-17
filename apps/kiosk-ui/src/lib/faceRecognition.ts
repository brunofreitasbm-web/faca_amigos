import * as faceapi from "@vladmandic/face-api";

// Modelos self-hosted em public/models (não CDN) — o quiosque precisa
// funcionar mesmo com a internet do local instável/fora do ar, e um
// registro de ponto (valor legal, Portaria MTP 671/2021) não pode depender
// de um CDN externo responder a tempo. Ver README de apps/kiosk-ui para o
// passo de baixar os pesos (~6MB) antes do primeiro build.
const MODEL_URL = "/models";

// Mesmo limiar usado no sistema irmão (Porto Terapia): abaixo de 0.45,
// distância euclidiana entre os dois descriptors de 128 floats é
// considerada "mesma pessoa" pelo face-api.js/@vladmandic face-api.
const MATCH_THRESHOLD = 0.45;

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

/** Extrai o descriptor facial (128 floats) do frame atual de um <video> com a webcam ligada. Null se nenhum rosto foi detectado. */
export async function extractFaceDescriptor(video: HTMLVideoElement): Promise<number[] | null> {
  await loadFaceModels();
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
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
