import { useEffect, useState } from "react";
import { Button, Card, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import { applyPwaUpdate } from "../pwa.js";
import { useToast } from "../state/ToastContext.js";

export interface UpdateStatusState {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  version?: string;
  progress?: number;
  error?: string;
}

export function AutoUpdateCard() {
  const toast = useToast();
  const [updateState, setUpdateState] = useState<UpdateStatusState>({ status: "idle" });
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);

  // 1. Escuta mudanças de status no Electron ou busca da API do sistema local
  useEffect(() => {
    if (window.facaamigos?.onUpdateStatusChange) {
      setIsElectron(true);
      window.facaamigos.getAppVersion?.().then((v) => {
        if (v) setDesktopVersion(v);
      });
      window.facaamigos.getUpdateStatus?.().then((st) => {
        if (st) setUpdateState(st as UpdateStatusState);
      });

      const unsubscribe = window.facaamigos.onUpdateStatusChange((st) => {
        if (st) setUpdateState(st as UpdateStatusState);
      });

      return () => {
        unsubscribe();
      };
    } else {
      // Fallback via HTTP API local (/api/system/info)
      Api.systemInfo().then((res) => {
        if (res?.update) {
          setUpdateState(res.update as UpdateStatusState);
        }
      });
    }
  }, []);

  async function handleCheckForUpdates() {
    setChecking(true);
    try {
      if (isElectron && window.facaamigos?.checkForUpdates) {
        const res = await window.facaamigos.checkForUpdates();
        if (res) setUpdateState(res as UpdateStatusState);
        toast.success("Verificação de atualização iniciada.");
      } else {
        const res = await Api.checkSystemUpdate();
        if (res?.update) {
          setUpdateState(res.update as UpdateStatusState);
          toast.success("Verificação de atualização solicitada.");
        } else {
          toast.success("Sistema já está atualizado com a versão do servidor.");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível verificar atualizações.");
    } finally {
      setChecking(false);
    }
  }

  async function handleApplyUpdate() {
    setApplying(true);
    try {
      if (isElectron && window.facaamigos?.applyUpdate) {
        toast.success("Aplicando atualização... O aplicativo será reiniciado em instantes.");
        await window.facaamigos.applyUpdate();
      } else {
        await Api.applySystemUpdate();
        applyPwaUpdate();
        toast.success("Recarregando o aplicativo para aplicar novas atualizações...");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao aplicar a atualização.");
      setApplying(false);
    }
  }

  const currentVersionStr = desktopVersion
    ? `v${desktopVersion}`
    : typeof __APP_VERSION__ !== "undefined"
      ? `v${__APP_VERSION__}`
      : "dev";

  const buildShaStr = typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "dev";

  const isDownloaded = updateState.status === "downloaded" || updateState.status === "available";
  const isDownloading = updateState.status === "downloading" || (updateState.progress ?? 0) > 0;
  const isChecking = updateState.status === "checking" || checking;

  return (
    <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "16px", margin: 0 }}>
          🚀 Versão e Atualização do Sistema
        </h2>
        {isDownloaded ? (
          <span
            style={{
              background: "rgba(40, 167, 69, 0.15)",
              color: "#28a745",
              padding: "4px 10px",
              borderRadius: "12px",
              fontSize: "12px",
              fontWeight: "bold",
            }}
          >
            🎉 Nova Versão Pronta
          </span>
        ) : isDownloading ? (
          <span
            style={{
              background: "rgba(0, 123, 255, 0.15)",
              color: "#007bff",
              padding: "4px 10px",
              borderRadius: "12px",
              fontSize: "12px",
              fontWeight: "bold",
            }}
          >
            📥 Baixando... {Math.round(updateState.progress ?? 0)}%
          </span>
        ) : (
          <span
            style={{
              background: "rgba(255, 193, 7, 0.15)",
              color: "#b8860b",
              padding: "4px 10px",
              borderRadius: "12px",
              fontSize: "12px",
              fontWeight: "bold",
            }}
          >
            {currentVersionStr} ({buildShaStr})
          </span>
        )}
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>
        Versão atual em execução: <strong>{currentVersionStr}</strong> (build <code style={{ fontFamily: "monospace" }}>{buildShaStr}</code>).
        {isElectron ? " O auto-updater verifica novas versões a cada 15 minutos e instala automaticamente durante a madrugada." : " Atualizações de PWA/Web são aplicadas sincronizadas com a versão do servidor."}
      </p>

      {/* Barra de Progresso de Download */}
      {isDownloading && typeof updateState.progress === "number" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
            <span>Baixando arquivos da nova versão...</span>
            <strong>{Math.round(updateState.progress)}%</strong>
          </div>
          <div style={{ width: "100%", height: "8px", background: "var(--border-subtle, #333)", borderRadius: "4px", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, Math.max(0, updateState.progress))}%`,
                height: "100%",
                background: "var(--color-primary, #F0196B)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Mensagem de Erro se houver */}
      {updateState.status === "error" && updateState.error && (
        <HelpText icon="⚠️" style={{ color: "var(--danger, #d9534f)" }}>
          Falha na verificação de atualização: {updateState.error}
        </HelpText>
      )}

      {/* Sucesso / Pronto para instalar */}
      {isDownloaded && (
        <HelpText icon="🎉" style={{ color: "#28a745" }}>
          A versão <strong>{updateState.version || "mais recente"}</strong> já foi baixada com sucesso e está pronta para ser aplicada. Clique no botão abaixo para reiniciar o sistema.
        </HelpText>
      )}

      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <Button
          variant="secondary"
          size="sm"
          loading={isChecking}
          disabled={isDownloading || applying}
          onClick={handleCheckForUpdates}
        >
          🔍 Buscar Atualizações Agora
        </Button>

        {isDownloaded && (
          <Button
            variant="primary"
            size="sm"
            loading={applying}
            onClick={handleApplyUpdate}
          >
            ⚡ Atualizar e Reiniciar Agora
          </Button>
        )}
      </div>
    </Card>
  );
}
