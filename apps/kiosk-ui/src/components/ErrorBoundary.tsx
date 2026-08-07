import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by Error Boundary:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", backgroundColor: "#fff0f0", padding: "20px", fontFamily: "sans-serif" }}>
          <div style={{ maxWidth: "500px", width: "100%", padding: "30px", textAlign: "center", backgroundColor: "#ffffff", border: "1px solid #ffcccc", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
            <h1 style={{ color: "#d32f2f", marginTop: 0, fontSize: "24px" }}>Ops, algo deu errado!</h1>
            <p style={{ color: "#555555", fontSize: "16px", marginBottom: "20px" }}>
              Ocorreu um erro inesperado e esta tela travou.
            </p>
            <pre style={{ textAlign: "left", background: "#ffebee", padding: "12px", borderRadius: "8px", overflow: "auto", fontSize: "13px", color: "#c62828", marginBottom: "20px" }}>
              {this.state.error?.message}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              style={{ backgroundColor: "#d32f2f", color: "white", border: "none", padding: "10px 20px", borderRadius: "8px", fontSize: "16px", cursor: "pointer" }}
            >
              Recarregar Aplicativo
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
