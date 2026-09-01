import { describe, expect, it } from "vitest";
import { assertValidImageUpload, compressImageForUpload } from "../src/lib/imageCompression";

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

  it("retorna o próprio arquivo se não for uma imagem", async () => {
    const textFile = new File(["hello"], "hello.txt", { type: "text/plain" });
    const result = await compressImageForUpload(textFile);
    expect(result).toBe(textFile);
  });
});
