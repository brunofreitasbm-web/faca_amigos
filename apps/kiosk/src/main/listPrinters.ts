import { execFile } from "node:child_process";

/**
 * Fallback via `Get-Printer` (mesma família de API do spooler do Windows —
 * winspool.drv — que o RAW print em rawPrint.ts usa para imprimir de verdade)
 * para quando `webContents.getPrintersAsync()` do Chromium volta vazio mesmo
 * com uma impressora instalada e funcionando em outros programas. É um bug
 * conhecido do backend de impressão do Chromium: alguns drivers (comuns em
 * impressoras térmicas/ESC-POS instaladas via utilitário do fabricante, não
 * pelo assistente padrão do Windows) não aparecem na enumeração dele, mesmo
 * existindo como fila de impressão válida no spooler.
 */
function listPrintersViaPowerShell(): Promise<string[]> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve([]);
      return;
    }
    const psScript = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
      $printers = @()
      try {
        $printers = (Get-Printer | Select-Object -ExpandProperty Name)
      } catch {}
      if (-not $printers -or $printers.Count -eq 0) {
        try {
          $printers = (Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name)
        } catch {}
      }
      $printers -join "\`n"
    `;
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
      { timeout: 10_000 },
      (err, stdout) => {
        if (err) {
          console.warn("[main] fallback Get-Printer/Win32_Printer falhou ao listar impressoras:", err);
          resolve([]);
          return;
        }
        const names = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        resolve(names);
      },
    );
  });
}

/**
 * Lista impressoras instaladas combinando o backend de impressão do
 * Chromium (`getPrintersAsync`) com o fallback via PowerShell/spooler acima.
 * Roda os dois em paralelo e junta os nomes (sem duplicar) — assim uma
 * impressora que só aparece em um dos dois caminhos ainda é detectada.
 */
export async function listWindowsPrinters(getChromiumPrinters: () => Promise<{ name: string }[]>): Promise<{ name: string }[]> {
  const [chromiumResult, powershellResult] = await Promise.all([
    getChromiumPrinters().catch((err) => {
      console.error("[main] falha ao listar impressoras via Chromium:", err);
      return [] as { name: string }[];
    }),
    listPrintersViaPowerShell(),
  ]);

  const names = new Set<string>();
  for (const p of chromiumResult) names.add(p.name);
  for (const name of powershellResult) names.add(name);

  return [...names].map((name) => ({ name }));
}
