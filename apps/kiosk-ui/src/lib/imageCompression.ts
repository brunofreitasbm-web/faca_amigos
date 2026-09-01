// Fotos tiradas direto da câmera do tablet/celular chegam em vários MB — sem
// redimensionar, fotos de envelopes, comprovantes, atestados ou cadastros inflam
// o Storage e deixam as telas lentas para carregar. Redimensiona para o maior
// lado caber em MAX_DIMENSION (1600px) e reexporta como JPEG comprimido (80% qualidade)
// antes do upload, garantindo nitidez e perfeita legibilidade de números e textos.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.80;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // acompanha o file_size_limit dos buckets no Supabase
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

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

export async function compressImageForUpload<T extends Blob>(file: T): Promise<T | File | Blob> {
  if (!file.type || !file.type.startsWith("image/")) return file;

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await loadImageSource(file);
  } catch {
    return file; // não trava a operação se a compressão falhar
  }

  const { width: sourceWidth, height: sourceHeight } = source;
  const maxDim = Math.max(sourceWidth, sourceHeight);

  // Se a imagem já for menor ou igual a MAX_DIMENSION e o arquivo já for pequeno (< 350KB), não reprocessa
  if (maxDim <= MAX_DIMENSION && file.size < 350 * 1024 && file.type === "image/jpeg") {
    return file;
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, 1));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  // Garante fundo branco ao converter imagens transparentes (PNG/WEBP) para JPEG
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob || blob.size >= file.size) return file; // só substitui se realmente reduziu o tamanho em bytes

  if (file instanceof File) {
    const newName = file.name ? file.name.replace(/\.\w+$/, ".jpg") : "foto.jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  }
  return blob;
}

function loadImageSource(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Falha ao carregar imagem"));
    img.src = URL.createObjectURL(file);
  });
}
