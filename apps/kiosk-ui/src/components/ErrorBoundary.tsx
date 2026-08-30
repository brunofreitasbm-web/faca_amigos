import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  updateStatus: "idle" | "checking" | "available" | "downloaded" | "error";
  updateVersion?: string;
  updateProgress?: number;
  updateError?: string;
  isChecking: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  private unsubscribeUpdate?: () => void;

  public override state: State = {
    hasError: false,
    updateStatus: "idle",
    isChecking: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by Error Boundary:", error, errorInfo);
    this.setupUpdateListener();
  }

  public override componentDidMount() {
    this.setupUpdateListener();
  }

  public override componentWillUnmount() {
    if (this.unsubscribeUpdate) {
      this.unsubscribeUpdate();
    }
  }

  private setupUpdateListener() {
    if (typeof window !== "undefined" && window.facaamigos && !this.unsubscribeUpdate) {
      void window.facaamigos.getUpdateStatus().then((status) => {
        if (status) {
          this.setState({
            updateStatus: (status.status as State["updateStatus"]) || "idle",
            updateVersion: status.version,
            updateProgress: status.progress,
            updateError: status.error,
          });
        }
      });

      this.unsubscribeUpdate = window.facaamigos.onUpdateStatusChange((data) => {
        this.setState({
          updateStatus: (data.status as State["updateStatus"]) || "idle",
          updateVersion: data.version,
          updateProgress: data.progress,
          updateError: data.error,
          isChecking: false,
        });
      });
    }
  }

  private handleCheckUpdates = async () => {
    if (typeof window !== "undefined" && window.facaamigos) {
      this.setState({ isChecking: true });
      try {
        const res = await window.facaamigos.checkForUpdates();
        if (res) {
          this.setState({
            updateStatus: (res.status as State["updateStatus"]) || "idle",
            updateVersion: res.version,
            updateProgress: res.progress,
            updateError: res.error,
          });
        }
      } catch (err) {
        console.warn("Falha ao checar atualizações no ErrorBoundary:", err);
      } finally {
        this.setState({ isChecking: false });
      }
    } else {
      window.location.reload();
    }
  };

  private handleApplyUpdate = async () => {
    if (typeof window !== "undefined" && window.facaamigos) {
      await window.facaamigos.applyUpdate();
    } else {
      window.location.reload();
    }
  };

  public override render() {
    if (this.state.hasError) {
      const isElectron = typeof window !== "undefined" && Boolean(window.facaamigos);
      const { updateStatus, updateVersion, updateProgress, updateError, isChecking } = this.state;

      return (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", backgroundColor: "#fff0f0", padding: "20px", fontFamily: "sans-serif" }}>
          <div style={{ maxWidth: "560px", width: "100%", padding: "32px", textAlign: "center", backgroundColor: "#ffffff", border: "1px solid #ffcccc", borderRadius: "16px", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
            <h1 style={{ color: "#d32f2f", marginTop: 0, fontSize: "24px", fontWeight: "bold" }}>Ops, algo deu errado!</h1>
            <p style={{ color: "#555555", fontSize: "15px", marginBottom: "16px", lineHeight: "1.5" }}>
              Ocorreu um erro inesperado e esta tela travou.
            </p>

            <pre style={{ textAlign: "left", background: "#ffebee", padding: "14px", borderRadius: "8px", overflow: "auto", fontSize: "13px", color: "#c62828", marginBottom: "20px", maxHeight: "160px" }}>
              {this.state.error?.message ?? "Erro desconhecido"}
            </pre>

            {isElectron && (
              <div style={{ background: "#f8f9fa", padding: "16px", borderRadius: "12px", border: "1px solid #e9ecef", marginBottom: "20px", textAlign: "left" }}>
                <div style={{ fontWeight: 600, fontSize: "14px", color: "#333", marginBottom: "6px" }}>
                  Status de Atualização do Terminal:
                </div>
                {updateStatus === "checking" || isChecking ? (
                  <div style={{ color: "#1976d2", fontSize: "13px" }}>🔍 Buscando atualizações no servidor...</div>
                ) : updateStatus === "available" ? (
                  <div style={{ color: "#ed6c02", fontSize: "13px" }}>
                    ⬇️ Baixando nova versão {updateVersion ? `(${updateVersion})` : ""}: {updateProgress ?? 0}%
                  </div>
                ) : updateStatus === "downloaded" ? (
                  <div style={{ color: "#2e7d32", fontSize: "13px", fontWeight: 600 }}>
                    ✅ Nova versão {updateVersion} baixada e pronta para instalar!
                  </div>
                ) : updateError ? (
                  <div style={{ color: "#d32f2f", fontSize: "13px" }}>⚠️ Erro na checagem: {updateError}</div>
                ) : (
                  <div style={{ color: "#666", fontSize: "13px" }}>O sistema está pronto para verificar novas versões.</div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              {updateStatus === "downloaded" ? (
                <button 
                  onClick={this.handleApplyUpdate}
                  style={{ backgroundColor: "#2e7d32", color: "white", border: "none", padding: "12px 24px", borderRadius: "8px", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}
                >
                  🚀 Aplicar Atualização Agora
                </button>
              ) : (
                <>
                  {isElectron && (
                    <button 
                      onClick={this.handleCheckUpdates}
                      disabled={isChecking || updateStatus === "checking"}
                      style={{ backgroundColor: "#1976d2", color: "white", border: "none", padding: "12px 20px", borderRadius: "8px", fontSize: "15px", fontWeight: 600, cursor: "pointer", opacity: isChecking ? 0.7 : 1 }}
                    >
                      {isChecking || updateStatus === "checking" ? "Verificando..." : "Buscar Atualizações"}
                    </button>
                  )}
                  <button 
                    onClick={() => window.location.reload()}
                    style={{ backgroundColor: "#d32f2f", color: "white", border: "none", padding: "12px 20px", borderRadius: "8px", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}
                  >
                    Recarregar Aplicativo
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

