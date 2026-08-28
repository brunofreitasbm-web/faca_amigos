import { useEffect, useState } from "react";

// __APP_VERSION__/__BUILD_SHA__ são injetadas em build-time pelo `define`
// em vite.config.ts (tipadas em vite-env.d.ts) — funciona tanto no bundle
// empacotado no Electron quanto no deploy PWA da Vercel, já que os dois
// consomem o mesmo bundle JS gerado por este build.
export function VersionBadge() {
  const [updateState, setUpdateState] = useState<{
    status: string;
    version?: string;
    progress?: number;
    error?: string;
  }>({ status: "idle" });

  useEffect(() => {
    // Escutar eventos do Electron se disponíveis
    if (window.facaamigos?.getUpdateStatus) {
      window.facaamigos.getUpdateStatus().then((s) => {
        if (s && typeof s === "object") setUpdateState(s);
      });
    }
    if (window.facaamigos?.onUpdateStatusChange) {
      return window.facaamigos.onUpdateStatusChange((s) => {
        if (s && typeof s === "object") setUpdateState(s);
      });
    }

    // Fallback periodic polling via HTTP para tablets/PWA
    const fetchInfo = () => {
      fetch("/api/system/info")
        .then((res) => res.json())
        .then((data: { update?: { status: string; version?: string; progress?: number; error?: string } }) => {
          if (data?.update) setUpdateState(data.update);
        })
        .catch(() => {});
    };

    fetchInfo();
    const interval = setInterval(fetchInfo, 30_000);
    return () => clearInterval(interval);
  }, []);

  const isDownloaded = updateState.status === "downloaded";
  const isDownloading = updateState.status === "available";

  const handleApply = async () => {
    if (!isDownloaded) return;
    try {
      if (window.facaamigos?.applyUpdate) {
        await window.facaamigos.applyUpdate();
      } else {
        await fetch("/api/system/update/apply", { method: "POST" });
      }
    } catch (err) {
      console.error("Erro ao aplicar atualização:", err);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "6px",
        right: "8px",
        zIndex: 9999,
        fontSize: "11px",
        fontFamily: "var(--font-body)",
        color: isDownloaded ? "#FFFFFF" : isDownloading ? "#FFE234" : "var(--text-muted)",
        backgroundColor: isDownloaded ? "#F0196B" : isDownloading ? "rgba(0,0,0,0.85)" : "transparent",
        padding: isDownloaded || isDownloading ? "4px 8px" : "0",
        borderRadius: "6px",
        boxShadow: isDownloaded ? "0 2px 8px rgba(240, 25, 107, 0.5)" : "none",
        cursor: isDownloaded ? "pointer" : "default",
        pointerEvents: isDownloaded ? "auto" : "none",
        userSelect: "none",
        transition: "all 0.3s ease",
        display: "flex",
        alignItems: "center",
        gap: "6px",
      }}
      onClick={isDownloaded ? handleApply : undefined}
      title={isDownloaded ? "Clique para reiniciar e aplicar a nova versão agora" : undefined}
    >
      {isDownloaded ? (
        <>🚀 Nova versão {updateState.version ?? ""} pronta! (Clique para reiniciar)</>
      ) : isDownloading ? (
        <>⏳ Baixando versão {updateState.version ?? ""} ({updateState.progress ?? 0}%)...</>
      ) : (
        <>v{__APP_VERSION__} · {__BUILD_SHA__}</>
      )}
    </div>
  );
}

