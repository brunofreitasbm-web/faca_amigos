import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PS_SCRIPT = `
param(
    [string]$PrinterName,
    [string]$FilePath
)

$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    // Códigos: 0 ok | 1 arquivo ausente | 2 OpenPrinter | 3 StartDoc | 4 StartPage
    //          5 WritePrinter | 6 falha em EndPage/EndDoc DEPOIS de escrever
    public static string PrintFile(string printerName, string filePath) {
        if (!File.Exists(filePath)) return "RESULT|1|0|0|0";
        byte[] bytes = File.ReadAllBytes(filePath);
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "FacaAmigos RAW Print";
        di.pDataType = "RAW";
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return "RESULT|2|0|" + bytes.Length + "|" + Marshal.GetLastWin32Error();
        if (!StartDocPrinter(hPrinter, 1, di)) { int e = Marshal.GetLastWin32Error(); ClosePrinter(hPrinter); return "RESULT|3|0|" + bytes.Length + "|" + e; }
        if (!StartPagePrinter(hPrinter)) { int e = Marshal.GetLastWin32Error(); EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return "RESULT|4|0|" + bytes.Length + "|" + e; }
        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
        int written = 0;
        bool success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
        int werr = success ? 0 : Marshal.GetLastWin32Error();
        Marshal.FreeCoTaskMem(pUnmanagedBytes);
        bool endPage = EndPagePrinter(hPrinter);
        bool endDoc = EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
        if (!success || written != bytes.Length) return "RESULT|5|" + written + "|" + bytes.Length + "|" + werr;
        if (!endPage || !endDoc) return "RESULT|6|" + written + "|" + bytes.Length + "|0";
        return "RESULT|0|" + written + "|" + bytes.Length + "|0";
    }
}
"@

$ErrorActionPreference = "Stop"
try {
    Add-Type -TypeDefinition $code
    Write-Output "COMPILED"
    Write-Output ([RawPrinterHelper]::PrintFile($PrinterName, $FilePath))
} catch {
    Write-Output ("ERROR|" + $_.Exception.Message)
    exit 1
}
`;

/** Teto para compilar o C# + gravar no spooler. Estourou = resultado incerto. */
export const RAW_PRINT_TIMEOUT_MS = 45_000;

/**
 * SENT      — o spooler aceitou todos os bytes e fechou o documento.
 * NOT_SENT  — falhou ANTES de qualquer byte chegar ao spooler: seguro cair
 *             para o fallback gráfico (nada saiu no papel).
 * UNCERTAIN — os bytes podem ter chegado (WritePrinter parcial/EndDoc falhou,
 *             timeout ou crash depois do Add-Type). NÃO reimprimir por outro
 *             caminho: o risco é cupom duplicado.
 */
export type RawPrintStatus = "SENT" | "NOT_SENT" | "UNCERTAIN";
export interface RawPrintResult {
  status: RawPrintStatus;
  detail: string;
}

/** Exportada para teste: interpreta stdout/erro do runner PowerShell. */
export function classifyRawPrintOutput(stdout: string, err: { code?: unknown; killed?: boolean; message?: string } | null): RawPrintResult {
  const lines = String(stdout ?? "").split(/\r?\n/).map((l) => l.trim());
  const compiled = lines.includes("COMPILED");
  const resultLine = lines.find((l) => l.startsWith("RESULT|"));

  if (resultLine) {
    const [, codeStr, written, total, win32] = resultLine.split("|");
    const code = Number(codeStr);
    const info = `código ${code}, escritos ${written}/${total}, erro win32 ${win32}`;
    if (code === 0) return { status: "SENT", detail: info };
    if (code >= 1 && code <= 4) return { status: "NOT_SENT", detail: info };
    if (code === 5 && Number(written) === 0) return { status: "NOT_SENT", detail: info };
    return { status: "UNCERTAIN", detail: info };
  }

  const reason = err?.killed ? `timeout (${RAW_PRINT_TIMEOUT_MS}ms)` : (err?.message ?? "sem resultado do runner");
  // Sem RESULT: se o C# ainda nem compilou, nenhum byte foi enviado.
  if (!compiled) return { status: "NOT_SENT", detail: `runner falhou antes de enviar: ${reason}` };
  return { status: "UNCERTAIN", detail: `runner terminou sem confirmar o envio: ${reason}` };
}

export async function printRawWindows(rawContent: string | Buffer, deviceName: string): Promise<RawPrintResult> {
  if (process.platform !== "win32") return { status: "NOT_SENT", detail: "plataforma não é Windows" };

  const id = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpFile = join(tmpdir(), `fa_print_${id}.raw`);
  // Nome único por chamada: dois jobs simultâneos nunca regravam o .ps1 um do outro.
  const psFile = join(tmpdir(), `fa_print_raw_runner_${id}.ps1`);

  try {
    if (typeof rawContent === "string") {
      await writeFile(tmpFile, rawContent, "utf8");
    } else {
      await writeFile(tmpFile, rawContent);
    }
    // BOM: o PowerShell 5 lê .ps1 sem BOM como ANSI.
    await writeFile(psFile, "\uFEFF" + PS_SCRIPT, "utf8");
  } catch (err) {
    void unlink(tmpFile).catch(() => {});
    void unlink(psFile).catch(() => {});
    console.warn("[print-bridge] Erro ao preparar RAW print:", err);
    return { status: "NOT_SENT", detail: `falha ao preparar arquivos temporários: ${err instanceof Error ? err.message : String(err)}` };
  }

  return await new Promise<RawPrintResult>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psFile, "-PrinterName", deviceName, "-FilePath", tmpFile],
      { timeout: RAW_PRINT_TIMEOUT_MS, killSignal: "SIGKILL", windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        void unlink(tmpFile).catch(() => {});
        void unlink(psFile).catch(() => {});
        // Em timeout o stdout parcial vem no próprio erro.
        const out = stdout || String((err as { stdout?: unknown } | null)?.stdout ?? "");
        const result = classifyRawPrintOutput(out, err);
        if (result.status === "SENT") {
          console.log(`[print-bridge] Impressão RAW enviada com sucesso para "${deviceName}" (${result.detail}).`);
        } else {
          console.warn(`[print-bridge] RAW print ${result.status} em "${deviceName}": ${result.detail}`);
        }
        resolve(result);
      },
    );
  });
}
