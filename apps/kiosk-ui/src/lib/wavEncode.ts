/**
 * Converte o blob gravado pelo MediaRecorder (normalmente webm/opus) para
 * WAV PCM16 mono 16kHz — exatamente o que o whisper.cpp exige
 * (apps/kiosk/src/main/voiceWorker.ts) e o único formato que a rota
 * POST /api/voz/recordings aceita. Não há ffmpeg no PC do quiosque, então
 * a conversão acontece aqui, no navegador, com as Web Audio APIs.
 */

const TARGET_SAMPLE_RATE = 16000;

export interface EncodedWav {
  wav: ArrayBuffer;
  durationMs: number;
}

function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function encodeWavHeader(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // tamanho do bloco fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (16 bit mono)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, samples[i] ?? 0, true);
  }

  return buffer;
}

/**
 * Decodifica o blob gravado e reamostra para 16 kHz mono via
 * OfflineAudioContext (o decodeAudioData de um AudioContext "vivo" é
 * necessário para entender opus/webm; OfflineAudioContext sozinho não
 * decodifica containers comprimidos, só faz o resample depois).
 */
export async function encodeWav16kMono(blob: Blob): Promise<EncodedWav> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const decodeCtx = new AudioContextCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await decodeCtx.close().catch(() => {});
  }

  const durationMs = Math.round((decoded.length / decoded.sampleRate) * 1000);
  const targetLength = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));

  const OfflineCtor = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const offline = new OfflineCtor(1, targetLength, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();

  const mono = rendered.getChannelData(0);
  const pcm16 = floatTo16BitPcm(mono);
  const wav = encodeWavHeader(pcm16, TARGET_SAMPLE_RATE);

  return { wav, durationMs };
}
