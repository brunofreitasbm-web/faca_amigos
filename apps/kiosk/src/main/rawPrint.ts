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

    public static bool PrintFile(string printerName, string filePath) {
        if (!File.Exists(filePath)) return false;
        byte[] bytes = File.ReadAllBytes(filePath);
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "FaçaAmigos RAW Print";
        di.pDataType = "RAW";
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
        if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); return false; }
        if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
        int written;
        bool success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
        Marshal.FreeCoTaskMem(pUnmanagedBytes);
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
        return success;
    }
}
"@

Add-Type -TypeDefinition $code
$result = [RawPrinterHelper]::PrintFile($PrinterName, $FilePath)
if ($result) {
    Write-Host "SUCCESS"
} else {
    Write-Error "FAILED_RAW_PRINT"
}
`;

export async function printRawWindows(rawContent: string | Buffer, deviceName: string): Promise<boolean> {
  if (process.platform !== "win32") return false;

  const tmpFile = join(tmpdir(), `fa_print_${Date.now()}_${Math.random().toString(36).slice(2)}.raw`);
  const psFile = join(tmpdir(), `fa_print_raw_runner.ps1`);

  try {
    if (typeof rawContent === "string") {
      await writeFile(tmpFile, rawContent, "utf8");
    } else {
      await writeFile(tmpFile, rawContent);
    }
    await writeFile(psFile, PS_SCRIPT, "utf8");

    return await new Promise<boolean>((resolve) => {
      execFile(
        "powershell.exe",
        ["-ExecutionPolicy", "Bypass", "-File", psFile, "-PrinterName", deviceName, "-FilePath", tmpFile],
        (err, stdout) => {
          void unlink(tmpFile).catch(() => {});
          if (err || !stdout.includes("SUCCESS")) {
            console.warn("[print-bridge] RAW print falhou, usando fallback gráfico HTML:", err || stdout);
            resolve(false);
          } else {
            console.log(`[print-bridge] Impressão RAW enviada com sucesso para "${deviceName}".`);
            resolve(true);
          }
        },
      );
    });
  } catch (err) {
    console.warn("[print-bridge] Erro ao preparar RAW print:", err);
    return false;
  }
}
