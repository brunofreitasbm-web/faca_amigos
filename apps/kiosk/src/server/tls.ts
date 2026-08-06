import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import selfsigned from "selfsigned";

export interface TlsMaterial {
  key: string;
  cert: string;
}

/**
 * TLS autoassinado gerado na primeira execução (seção 7.3 do plano):
 * CN "kiosk.local" + IPs comuns de LAN como SAN. Necessário para
 * BarcodeDetector/getUserMedia no tablet (câmera só funciona em
 * contexto seguro) — ainda não usado por padrão porque a leitura de
 * QR por câmera não está ligada nesta fase (ver security/codes.ts).
 *
 * Fica cacheado em disco: gerar de novo a cada boot invalidaria o
 * certificado que os tablets já aceitaram manualmente uma vez.
 */
export function loadOrCreateTls(certDir: string): TlsMaterial {
  const keyPath = join(certDir, "kiosk-key.pem");
  const certPath = join(certDir, "kiosk-cert.pem");

  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath, "utf-8"), cert: readFileSync(certPath, "utf-8") };
  }

  const attrs = [{ name: "commonName", value: "kiosk.local" }];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "kiosk.local" }, // DNS
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" }, // IP
        ],
      },
    ],
  });

  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  writeFileSync(certPath, pems.cert);

  return { key: pems.private, cert: pems.cert };
}
