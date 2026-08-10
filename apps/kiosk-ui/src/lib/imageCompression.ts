// Fotos tiradas direto da câmera do tablet/celular chegam em vários MB — sem
// redimensionar, cada envelope registrado infla o Storage e deixa a grade de
// fotos (FotosEnvelopeTab) lenta para carregar. Redimensiona para o maior
// lado caber em MAX_DIMENSION e reexporta como JPEG comprimido antes do
// upload; documentos/números do envelope continuam legíveis nesse tamanho.
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.72;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // acompanha o file_size_limit dos buckets no Supabase
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * `file.type` vem do navegador (a partir da extensão/sniffing do cliente),
 * não é prova de conteúdo — mas barrar aqui evita o caso comum de anexar
 * algo que não é imagem por engano, e principalmente evita gravar esse
 * `file.type` sem checagem como content-type servido pelo bucket público
 * (ver correção da auditoria de 2026-08-10, item 7: sem essa validação, um
 * upload com file.type "text/html" era aceito e servido de volta como tal).
 */
export function assertValidImageUpload(file: Blob): void {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Selecione uma imagem JPG, PNG ou WEBP.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("A imagem deve ter no máximo 8MB.");
  }
}

export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await loadImageSource(file);
  } catch {
    return file; // não trava o registro do envelope se a compressão falhar
  }

  const { width: sourceWidth, height: sourceHeight } = source;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob || blob.size >= file.size) return file; // só troca se realmente ficou menor

  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}

function loadImageSource(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Falha ao carregar imagem"));
    img.src = URL.createObjectURL(file);
  });
}
