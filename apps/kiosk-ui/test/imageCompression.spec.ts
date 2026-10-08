import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertValidDocumentUpload,
  assertValidImageUpload,
  canvasToImageBlob,
  compressImage,
  compressPdf,
  prepareUpload,
  sniffMime,
  uploadFileName,
  type PdfImageEncoder,
} from "../src/lib/imageCompression";

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

function bytesBlob(head: number[], size: number, type = ""): Blob {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return new Blob([bytes], { type });
}

interface CanvasStub {
  width: number;
  height: number;
  getContext: () => { drawImage: () => void };
  toBlob: (cb: (b: Blob | null) => void, type: string, quality?: number) => void;
}

/** Simula o navegador: bitmap com as dimensões dadas e um canvas cujo encoder devolve `encoded` por tipo. */
function stubBrowser(opts: { width: number; height: number; webp?: boolean; encodedSize?: number }) {
  const canvases: CanvasStub[] = [];
  const toBlobCalls: string[] = [];
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: opts.width, height: opts.height, close })));
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas: CanvasStub = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (cb, type) => {
          toBlobCalls.push(type);
          const supported = type === "image/webp" ? opts.webp !== false : true;
          const mime = supported ? type : "image/png"; // navegador sem encoder WebP devolve PNG
          cb(bytesBlob([], opts.encodedSize ?? 10_000, mime));
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  return { canvases, toBlobCalls, close };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("imageCompression", () => {
  it("valida o tipo de imagem e aceita JPG, PNG e WEBP", () => {
    const validBlob = new Blob(["fake-image-data"], { type: "image/jpeg" });
    expect(() => assertValidImageUpload(validBlob)).not.toThrow();

    const invalidBlob = new Blob(["fake-text"], { type: "text/plain" });
    expect(() => assertValidImageUpload(invalidBlob)).toThrow("Selecione uma imagem válida");
  });

  it("rejeita arquivos maiores que 8MB", () => {
    const hugeBlob = {
      size: 9 * 1024 * 1024,
      type: "image/jpeg",
    } as Blob;

    expect(() => assertValidImageUpload(hugeBlob)).toThrow("A imagem deve ter no máximo 8MB");
  });

  it("assertValidDocumentUpload aceita PDF e imagem, rejeita outros tipos", () => {
    expect(() => assertValidDocumentUpload(new Blob(["x"], { type: "application/pdf" }))).not.toThrow();
    expect(() => assertValidDocumentUpload(new Blob(["x"], { type: "image/png" }))).not.toThrow();
    expect(() => assertValidDocumentUpload(new Blob(["x"], { type: "text/plain" }))).toThrow();
  });

  it("detecta o tipo pelos bytes, ignorando file.type", async () => {
    expect(await sniffMime(bytesBlob(JPEG_HEAD, 32, "image/png"))).toBe("image/jpeg");
    expect(await sniffMime(bytesBlob(PNG_HEAD, 32))).toBe("image/png");
    expect(await sniffMime(bytesBlob(WEBP_HEAD, 32))).toBe("image/webp");
    expect(await sniffMime(new Blob(["%PDF-1.7\n"]))).toBe("application/pdf");
    expect(await sniffMime(new Blob(["GIF89a...."]))).toBe("image/gif");
  });

  it("troca a extensão e higieniza o nome do arquivo", () => {
    expect(uploadFileName("Atestado médico.final.jpg", "webp")).toBe("Atestado_m_dico.final.webp");
    expect(uploadFileName(undefined, "pdf", "documento")).toBe("documento.pdf");
  });
});

describe("compressImage", () => {
  it("converte PNG grande em WebP menor, com content-type e extensão do resultado", async () => {
    stubBrowser({ width: 4000, height: 3000, encodedSize: 80_000 });
    const png = bytesBlob(PNG_HEAD, 3_000_000, "image/png");
    const out = await compressImage(png, "foto");
    expect(out.contentType).toBe("image/webp");
    expect(out.ext).toBe("webp");
    expect(out.blob.size).toBeLessThan(png.size);
  });

  it("redimensiona pelo preset mantendo a proporção e sem upscale", async () => {
    const { canvases } = stubBrowser({ width: 4000, height: 3000 });
    await compressImage(bytesBlob(PNG_HEAD, 3_000_000, "image/png"), "foto");
    expect([canvases[0].width, canvases[0].height]).toEqual([1600, 1200]);

    const small = stubBrowser({ width: 300, height: 200 });
    await compressImage(bytesBlob(PNG_HEAD, 500_000, "image/png"), "documento");
    expect([small.canvases[0].width, small.canvases[0].height]).toEqual([300, 200]);
  });

  it("selfie mantém a resolução da captura e avatar reduz para 512px", async () => {
    const selfie = stubBrowser({ width: 1280, height: 960 });
    await compressImage(bytesBlob(PNG_HEAD, 2_000_000, "image/png"), "selfie");
    expect([selfie.canvases[0].width, selfie.canvases[0].height]).toEqual([1280, 960]);

    const avatar = stubBrowser({ width: 1280, height: 960 });
    await compressImage(bytesBlob(PNG_HEAD, 2_000_000, "image/png"), "avatar");
    expect([avatar.canvases[0].width, avatar.canvases[0].height]).toEqual([512, 384]);
  });

  it("lê a imagem respeitando a orientação EXIF", async () => {
    stubBrowser({ width: 100, height: 100 });
    await compressImage(bytesBlob(JPEG_HEAD, 500_000, "image/jpeg"), "foto");
    expect(createImageBitmap).toHaveBeenCalledWith(expect.anything(), { imageOrientation: "from-image" });
  });

  it("cai para JPEG quando o navegador não gera WebP", async () => {
    const { toBlobCalls } = stubBrowser({ width: 4000, height: 3000, webp: false, encodedSize: 90_000 });
    const out = await compressImage(bytesBlob(PNG_HEAD, 3_000_000, "image/png"), "foto");
    expect(toBlobCalls).toEqual(["image/webp", "image/jpeg"]);
    expect(out.contentType).toBe("image/jpeg");
    expect(out.ext).toBe("jpg");
  });

  it("devolve o original JPEG/WebP quando o resultado não é menor", async () => {
    stubBrowser({ width: 800, height: 600, encodedSize: 500_000 });
    const jpeg = bytesBlob(JPEG_HEAD, 200_000, "image/jpeg");
    const out = await compressImage(jpeg, "foto");
    expect(out.blob).toBe(jpeg);
    expect(out.contentType).toBe("image/jpeg");
    expect(out.ext).toBe("jpg");
  });

  it("não reprocessa WebP pequeno dentro do limite do preset", async () => {
    const { canvases } = stubBrowser({ width: 800, height: 600 });
    const webp = bytesBlob(WEBP_HEAD, 100_000, "image/webp");
    const out = await compressImage(webp, "foto");
    expect(out.blob).toBe(webp);
    expect(canvases).toHaveLength(0);
  });

  it("canvasToImageBlob prefere WebP", async () => {
    stubBrowser({ width: 10, height: 10 });
    const canvas = (document as unknown as { createElement: () => CanvasStub }).createElement();
    const blob = await canvasToImageBlob(canvas as unknown as HTMLCanvasElement, 0.8);
    expect(blob?.type).toBe("image/webp");
  });
});

describe("prepareUpload", () => {
  it("roteia pelo tipo real, não pelo file.type", async () => {
    stubBrowser({ width: 4000, height: 3000, encodedSize: 50_000 });
    const out = await prepareUpload(bytesBlob(PNG_HEAD, 2_000_000, "image/jpeg"), "foto");
    expect(out.contentType).toBe("image/webp");
    expect(out.ext).toBe("webp");
  });

  it("deixa GIF, SVG e HEIC como estão", async () => {
    const { canvases } = stubBrowser({ width: 10, height: 10 });
    const gif = new Blob(["GIF89a...."], { type: "image/gif" });
    const gifOut = await prepareUpload(gif, "foto");
    expect(gifOut).toEqual({ blob: gif, contentType: "image/gif", ext: "gif" });

    const svg = new Blob(["<svg></svg>"], { type: "image/svg+xml" });
    expect((await prepareUpload(svg, "foto")).blob).toBe(svg);

    const heic = new Blob([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])], { type: "image/heic" });
    const heicOut = await prepareUpload(heic, "foto");
    expect(heicOut.blob).toBe(heic);
    expect(heicOut.ext).toBe("heic");
    expect(canvases).toHaveLength(0);
  });

  it("mantém o PDF com extensão pdf", async () => {
    const pdf = new Blob(["%PDF-1.4\nnada para comprimir"], { type: "application/pdf" });
    const out = await prepareUpload(pdf, "documento");
    expect(out.contentType).toBe("application/pdf");
    expect(out.ext).toBe("pdf");
  });
});

describe("compressPdf", () => {
  async function pdfWithRgbImage(): Promise<Uint8Array> {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const raw = new Uint8Array(300 * 300 * 3);
    let seed = 12345;
    for (let i = 0; i < raw.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      raw[i] = seed >>> 24; // ruído: deflate quase não reduz
    }
    const stream = doc.context.stream(deflateSync(raw), {
      Type: "XObject",
      Subtype: "Image",
      Width: 300,
      Height: 300,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "FlateDecode",
    });
    doc.context.register(stream);
    return doc.save();
  }

  const smallJpeg: PdfImageEncoder = vi.fn(async () => ({ jpeg: new Uint8Array(4_000), width: 300, height: 300 }));
  const tinyGain: PdfImageEncoder = vi.fn(async (input) => ({
    jpeg: new Uint8Array(input.bytes.length), // não reduz nada
    width: 300,
    height: 300,
  }));

  it("recomprime a imagem embutida e devolve um PDF pelo menos 15% menor", async () => {
    const original = new File([(await pdfWithRgbImage()) as BlobPart], "scan.pdf", { type: "application/pdf" });
    const out = await compressPdf(original, smallJpeg);
    expect(smallJpeg).toHaveBeenCalled();
    expect(out).not.toBe(original);
    expect(out.size).toBeLessThanOrEqual(original.size * 0.85);
    expect(out.type).toBe("application/pdf");
    expect((out as File).name).toBe("scan.pdf");
    expect(await sniffMime(out)).toBe("application/pdf");
  });

  it("mantém o original quando a economia fica abaixo de 15%", async () => {
    const original = new Blob([(await pdfWithRgbImage()) as BlobPart], { type: "application/pdf" });
    expect(await compressPdf(original, tinyGain)).toBe(original);
  });

  it("devolve intacto o PDF sem imagens recomprimíveis", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.addPage();
    const original = new Blob([(await doc.save()) as BlobPart], { type: "application/pdf" });
    expect(await compressPdf(original, smallJpeg)).toBe(original);
  });

  it("devolve intacto o PDF assinado (/ByteRange)", async () => {
    const bytes = await pdfWithRgbImage();
    const signed = new Blob([bytes as BlobPart, "\n% /Type /Sig /ByteRange [0 10 20 30]\n"], { type: "application/pdf" });
    const encoder = vi.fn(smallJpeg);
    expect(await compressPdf(signed, encoder)).toBe(signed);
    expect(encoder).not.toHaveBeenCalled();
  });

  it("devolve intacto o PDF criptografado ou ilegível", async () => {
    const encrypted = new Blob(
      [
        "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n" +
          "3 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -4 >>\nendobj\n" +
          "trailer\n<< /Root 1 0 R /Size 4 /Encrypt 3 0 R >>\n%%EOF",
      ],
      { type: "application/pdf" },
    );
    const encoder = vi.fn(smallJpeg);
    expect(await compressPdf(encrypted, encoder)).toBe(encrypted);

    const garbage = new Blob(["%PDF-1.4 lixo"], { type: "application/pdf" });
    expect(await compressPdf(garbage, encoder)).toBe(garbage);
    expect(encoder).not.toHaveBeenCalled();
  });
});
