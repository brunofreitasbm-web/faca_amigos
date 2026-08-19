import { useEffect, useState } from "react";
import { applyPwaUpdate, subscribePwaUpdate } from "../pwa.js";


/**
 * Banner discreto e elegante exibido quando uma nova versão
 * do aplicativo é detectada (via Electron AutoUpdater ou PWA Service Worker).
 */
export function UpdatePwaBanner() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    // 1. Inscrição para ambiente Electron
    if (window.facaamigos?.onUpdateStatusChange) {
      setIsElectron(true);
      window.facaamigos.getUpdateStatus?.().then((status) => {
        if (status?.status === "downloaded") {
          setHasUpdate(true);
          if (status.version) setNewVersion(status.version);
        }
      });

      const unsubscribe = window.facaamigos.onUpdateStatusChange((data) => {
        if (data?.status === "downloaded") {
          setHasUpdate(true);
          if (data.version) setNewVersion(data.version);
        }
      });

      return () => {
        unsubscribe();
      };
    }

    // 2. Inscrição para ambiente PWA Web / Tablets
    return subscribePwaUpdate(() => {
      setHasUpdate(true);
    });
  }, []);

  if (!hasUpdate) return null;

  const handleUpdate = () => {
    setUpdating(true);
    if (isElectron && window.facaamigos?.applyUpdate) {
      void window.facaamigos.applyUpdate();
    } else {
      applyPwaUpdate();
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: "fixed",
        top: `calc(12px + env(safe-area-inset-top, 0px))`,
        right: 12,
        left: 12,
        maxWidth: 480,
        margin: "0 auto",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 14,
        background: "linear-gradient(135deg, #1C1917 0%, #292524 100%)",
        color: "#FFFFFF",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(240, 25, 107, 0.3)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "rgba(240, 25, 107, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          🚀
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#FFFFFF" }}>
            {newVersion ? `Nova versão (${newVersion}) pronta` : "Nova versão disponível"}
          </div>
          <div style={{ fontSize: 12, color: "#A1A1AA", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Toque para atualizar e reiniciar o sistema
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleUpdate}
        disabled={updating}
        style={{
          background: "#F0196B",
          color: "#FFFFFF",
          border: "none",
          borderRadius: 10,
          padding: "8px 14px",
          fontWeight: 700,
          fontSize: 13,
          cursor: updating ? "wait" : "pointer",
          whiteSpace: "nowrap",
          flexShrink: 0,
          boxShadow: "0 2px 8px rgba(240, 25, 107, 0.4)",
          transition: "transform 0.1s ease, opacity 0.1s ease",
          opacity: updating ? 0.7 : 1,
        }}
      >
        {updating ? "Atualizando..." : "Atualizar Agora"}
      </button>
    </div>
  );
}

