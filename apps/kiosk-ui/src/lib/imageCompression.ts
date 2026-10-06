// Fotos tiradas direto da câmera do tablet/celular chegam em vários MB — sem
// redimensionar, fotos de envelopes, comprovantes, atestados ou cadastros inflam
// o Storage e deixam as telas lentas para carregar. Toda imagem enviada passa
// por `prepareUpload`: vira WebP (fallback JPEG se o navegador não gerar WebP),
// com o maior lado limitado por preset. PDFs só têm as imagens embutidas
// recomprimidas (pdf-lib, carregado sob demanda). Content-type e extensão do
// arquivo enviado vêm do resultado, nunca de valores fixos.
export type ImagePreset = "documento" | "foto" | "avatar" | "selfie";

interface PresetConfig {
  maxDimension: number;
  quality: number;
}

const PRESETS: Record<ImagePreset, PresetConfig> = {
  documento: { maxDimension: 2200, quality: 0.85 }, // texto pequeno precisa continuar legível
  foto: { maxDimension: 1600, quality: 0.82 },
  avatar: { maxDimension: 512, quality: 0.82 },
  selfie: { maxDimension: Number.POSITIVE_INFINITY, quality: 0.85 }, // mantém a resolução da captura (biometria)
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // acompanha o file_size_limit dos buckets no Supabase
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const SKIP_REENCODE_BYTES = 350 * 1024; // WebP/JPEG já pequeno e dentro do limite não é reprocessado

const PDF_MIN_SAVING = 0.15; // só troca o PDF se economizar pelo menos 15%
const PDF_MAX_IMAGE_SIDE = 2340; // ~200 dpi no lado maior de uma página A4
const PDF_JPEG_QUALITY = 0.8;
const PDF_MIN_IMAGE_BYTES = 20 * 1024; // imagens pequenas não valem a recompressão

export interface PreparedUpload {
  blob: Blob;
  contentType: string;
  ext: string;
}

/**
 * Valida o tipo e tamanho máximo da imagem antes de iniciar o processamento/upload.
 */
export function assertValidImageUpload(file: Blob): void {
  if (file.type && !ALLOWED_IMAGE_TYPES.includes(file.type) && !file.type.startsWith("image/")) {
    throw new Error("Selecione uma imagem válida (JPG, PNG ou WEBP).");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("A imagem deve ter no máximo 8MB.");
  }
}

/** Como assertValidImageUpload, mas também aceita PDF (anexos de ocorrência). */
export function assertValidDocumentUpload(file: Blob): void {
  if (file.type === "application/pdf") {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("O arquivo deve ter no máximo 8MB.");
    return;
  }
  assertValidImageUpload(file);
}

const EXT_BY_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

export function extensionForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

/** Detecta o tipo pelos primeiros bytes (file.type vem do navegador/SO e pode estar vazio ou errado). */
export async function sniffMime(blob: Blob): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 3) === "GIF") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1", "heim", "heis"].includes(brand)) return "image/heif";
  }
  return blob.type || "application/octet-stream";
}

/** Exporta o canvas como WebP; se o navegador não gerar WebP (devolve PNG), cai para JPEG. */
export async function canvasToImageBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  return toBlob("image/jpeg");
}

export async function compressImage(file: Blob, preset: ImagePreset): Promise<PreparedUpload> {
  const original: PreparedUpload = { blob: file, contentType: file.type, ext: extensionForMime(file.type) };
  const { maxDimension, quality } = PRESETS[preset];

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await loadImageSource(file);
  } catch {
    return original; // não trava a operação se a compressão falhar
  }

  const keepable = file.type === "image/webp" || file.type === "image/jpeg";
  if (
    file.type === "image/webp" &&
    Math.max(source.width, source.height) <= maxDimension &&
    file.size < SKIP_REENCODE_BYTES
  ) {
    return original;
  }

  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height, 1));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  ctx.drawImage(source, 0, 0, width, height); // WebP preserva a transparência de PNGs
  if ("close" in source) source.close();

  const blob = await canvasToImageBlob(canvas, quality);
  if (!blob) return original;
  if (keepable && blob.size >= file.size) return original; // só substitui se realmente reduziu o tamanho em bytes
  return { blob, contentType: blob.type, ext: extensionForMime(blob.type) };
}

/**
 * Ponto único de entrada dos uploads: roteia pelo tipo real (bytes), aplica o
 * preset e devolve blob + content-type + extensão corretos. Tipos que não
 * comprimimos (HEIC, GIF, SVG...) voltam como estão.
 */
export async function prepareUpload(file: Blob, preset: ImagePreset): Promise<PreparedUpload> {
  const mime = await sniffMime(file);
  if (mime === "application/pdf") {
    const blob = await compressPdf(file);
    return { blob, contentType: mime, ext: "pdf" };
  }
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") {
    return compressImage(file, preset);
  }
  return { blob: file, contentType: mime, ext: extensionForMime(mime) };
}

/** Troca a extensão do nome (ou acrescenta uma) e higieniza caracteres inválidos para path de Storage. */
export function uploadFileName(name: string | undefined, ext: string, fallback = "arquivo"): string {
  const base = (name || fallback).replace(/\.\w+$/, "").replace(/[^\w.-]/g, "_");
  return `${base || fallback}.${ext}`;
}

function loadImageSource(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file, { imageOrientation: "from-image" });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Falha ao carregar imagem"));
    img.src = URL.createObjectURL(file);
  });
}

// ---------------------------------------------------------------------------
// PDF

/** Reencoda uma imagem raster (RGBA ou JPEG original) como JPEG limitado a PDF_MAX_IMAGE_SIDE. */
export type PdfImageEncoder = (input: PdfImageInput) => Promise<{ jpeg: Uint8Array; width: number; height: number } | null>;

export type PdfImageInput =
  | { kind: "jpeg"; bytes: Uint8Array }
  | { kind: "raw"; bytes: Uint8Array; width: number; height: number; components: 1 | 3 };

const browserPdfImageEncoder: PdfImageEncoder = async (input) => {
  let source: CanvasImageSource & { width: number; height: number };
  if (input.kind === "jpeg") {
    source = await createImageBitmap(new Blob([input.bytes as BlobPart], { type: "image/jpeg" }));
  } else {
    const rgba = new Uint8ClampedArray(input.width * input.height * 4);
    for (let i = 0, p = 0; i < input.width * input.height; i++) {
      const o = i * input.components;
      rgba[p++] = input.bytes[o] ?? 0;
      rgba[p++] = input.bytes[input.components === 3 ? o + 1 : o] ?? 0;
      rgba[p++] = input.bytes[input.components === 3 ? o + 2 : o] ?? 0;
      rgba[p++] = 255;
    }
    const full = document.createElement("canvas");
    full.width = input.width;
    full.height = input.height;
    full.getContext("2d")?.putImageData(new ImageData(rgba, input.width, input.height), 0, 0);
    source = full;
  }
  const scale = Math.min(1, PDF_MAX_IMAGE_SIDE / Math.max(source.width, source.height, 1));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  if ("close" in source) (source as ImageBitmap).close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PDF_JPEG_QUALITY));
  if (!blob) return null;
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width, height };
};

/**
 * Recomprime só as imagens embutidas do PDF (PDF não suporta WebP nativamente,
 * então vira JPEG). Devolve o arquivo original se ele for assinado,
 * criptografado, não carregar, ou se a economia ficar abaixo de 15%.
 * `encode` é injetável para testes fora do navegador.
 */
export async function compressPdf<T extends Blob>(file: T, encode: PdfImageEncoder = browserPdfImageEncoder): Promise<T | Blob> {
  try {
    const original = new Uint8Array(await file.arrayBuffer());
    // Assinatura digital: qualquer reescrita invalida. Procura o /ByteRange em todo o arquivo.
    if (indexOfAscii(original, "/ByteRange") >= 0) return file;

    const { PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
    const doc = await PDFDocument.load(original, { ignoreEncryption: false, updateMetadata: false });

    let replaced = 0;
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      if (dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
      // Máscaras/transparência dependem de outros objetos: não mexe nessas imagens.
      if (dict.has(PDFName.of("SMask")) || dict.has(PDFName.of("Mask")) || dict.has(PDFName.of("ImageMask"))) continue;
      if (dict.has(PDFName.of("Decode"))) continue;

      const color = dict.get(PDFName.of("ColorSpace"));
      const components = color === PDFName.of("DeviceRGB") ? 3 : color === PDFName.of("DeviceGray") ? 1 : 0;
      const bits = dict.lookupMaybe(PDFName.of("BitsPerComponent"), PDFNumber)?.asNumber();
      const srcWidth = dict.lookupMaybe(PDFName.of("Width"), PDFNumber)?.asNumber() ?? 0;
      const srcHeight = dict.lookupMaybe(PDFName.of("Height"), PDFNumber)?.asNumber() ?? 0;
      if (!components || bits !== 8 || obj.getContentsSize() < PDF_MIN_IMAGE_BYTES) continue;

      const filter = dict.get(PDFName.of("Filter"));
      let input: PdfImageInput;
      if (filter === PDFName.of("DCTDecode")) {
        input = { kind: "jpeg", bytes: obj.getContents() };
      } else if (filter === PDFName.of("FlateDecode")) {
        const raw = decodePDFRawStream(obj).decode();
        if (raw.length !== srcWidth * srcHeight * components) continue;
        input = { kind: "raw", bytes: raw, width: srcWidth, height: srcHeight, components: components as 1 | 3 };
      } else {
        continue;
      }

      const out = await encode(input);
      if (!out || out.jpeg.length >= obj.getContentsSize()) continue;
      const stream = doc.context.stream(out.jpeg, {
        Type: "XObject",
        Subtype: "Image",
        Width: out.width,
        Height: out.height,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "DCTDecode",
      });
      doc.context.assign(ref, stream);
      replaced++;
    }
    if (!replaced) return file;

    const saved = await doc.save({ useObjectStreams: true });
    if (saved.length > original.length * (1 - PDF_MIN_SAVING)) return file;
    const bytes = saved as Uint8Array<ArrayBuffer>;
    if (file instanceof File) return new File([bytes], file.name, { type: "application/pdf" });
    return new Blob([bytes], { type: "application/pdf" });
  } catch {
    return file; // criptografado, corrompido ou fora do suporte: sobe como veio
  }
}

function indexOfAscii(haystack: Uint8Array, needle: string): number {
  const n = needle.length;
  outer: for (let i = 0; i <= haystack.length - n; i++) {
    for (let j = 0; j < n; j++) if (haystack[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}
