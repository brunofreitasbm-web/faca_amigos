// Fontes OFL (Fredoka One, Nunito) e logo FaçaAmigos do Olhar em PDF.
//
// Antes viajavam em base64 dentro do bundle da function (475 KB), o que impedia publicar o
// session-report-dispatch por ferramentas que exigem o conteúdo de cada arquivo. Agora ficam no app
// do kiosk (apps/kiosk-ui/public/olhar-assets/, servido pela Vercel) e a function baixa na primeira
// geração de PDF de cada instância e guarda em memória. Cada arquivo é conferido pelo SHA-256: se o
// app devolver outra coisa (ex.: o index.html do SPA antes do deploy dos arquivos, ou um arquivo
// cortado), a geração falha com erro claro em vez de gerar um PDF quebrado.
//
// Trocar fonte ou logo: substitua o arquivo em apps/kiosk-ui/public/olhar-assets/, atualize o
// sha256 abaixo (sha256sum) e publique primeiro o app, depois a function.
// OLHAR_ASSETS_BASE_URL (secret opcional) muda a origem, p.ex. para testar um preview.

const BASE_URL = (Deno.env.get("OLHAR_ASSETS_BASE_URL") ?? "https://app.institutofacaamigos.com.br/olhar-assets").replace(/\/+$/, "");

const FILES = {
  fredoka: { file: "FredokaOne_400Regular.ttf", sha256: "b8872191d5632ad3d98e72dc75d3621d14dfc230d41ba6ed540cffbabc0548c0" },
  nunitoReg: { file: "Nunito_400Regular.ttf", sha256: "1a025dfce6e6e03bbe31ba82277ec5ed96df8b8dd58b3df6267269490b90b1dc" },
  nunitoBold: { file: "Nunito_700Bold.ttf", sha256: "9ecbdba35fa74f10a1a916c31649b802a12deb9e66c7b1fe4650afcfd4d16971" },
  logo: { file: "logo.png", sha256: "38e1d0f842065f9bc28536e9d0d3556e60730803b0c8fd6d931eaaabcc2dd20d" },
} as const;

export interface BrandAssets {
  fredoka: Uint8Array;
  nunitoReg: Uint8Array;
  nunitoBold: Uint8Array;
  logo: Uint8Array;
}

const ATTEMPTS = 3;
const TIMEOUT_MS = 8000;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchVerified(entry: { file: string; sha256: string }): Promise<Uint8Array> {
  const url = `${BASE_URL}/${entry.file}`;
  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
      } else {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if ((await sha256Hex(bytes)) === entry.sha256) return bytes;
        lastError = `conteúdo diferente do esperado (${bytes.length} bytes, ${res.headers.get("content-type") ?? "sem content-type"})`;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 300 * attempt));
  }
  throw new Error(`asset do Olhar indisponível: ${url} — ${lastError}`);
}

let cached: Promise<BrandAssets> | null = null;

/** Baixa e confere os 4 arquivos uma vez por instância; falha não fica em cache (a próxima chamada tenta de novo). */
export function loadBrandAssets(): Promise<BrandAssets> {
  cached ??= Promise.all([
    fetchVerified(FILES.fredoka),
    fetchVerified(FILES.nunitoReg),
    fetchVerified(FILES.nunitoBold),
    fetchVerified(FILES.logo),
  ])
    .then(([fredoka, nunitoReg, nunitoBold, logo]) => ({ fredoka, nunitoReg, nunitoBold, logo }))
    .catch((e) => {
      cached = null;
      console.error(e instanceof Error ? e.message : e);
      throw e;
    });
  return cached;
}
