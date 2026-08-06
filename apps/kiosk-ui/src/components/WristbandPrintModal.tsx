import { Button, Card } from "@facaamigos/ui";

export interface WristbandData {
  wristbandCode: string;
  childName: string;
  guardianName: string;
  phone: string;
  planName?: string;
  notes?: string;
  entryTime?: string;
}

interface WristbandPrintModalProps {
  data: WristbandData;
  onClose: () => void;
}

export function WristbandPrintModal({ data, onClose }: WristbandPrintModalProps) {
  const nowStr = data.entryTime || new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  function handlePrint() {
    window.print();
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <Card style={{ maxWidth: "420px", width: "100%", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", margin: 0, color: "var(--color-primary)" }}>
          Impressão de Pulseira
        </h2>

        {/* Pré-visualização na tela */}
        <div
          style={{
            background: "#ffffff",
            color: "#141414",
            padding: "16px",
            borderRadius: "12px",
            border: "2px dashed var(--border-subtle)",
            fontFamily: "var(--font-body)",
          }}
        >
          <div className="wristband-printable">
            <div style={{ textAlign: "center", borderBottom: "2px solid #141414", paddingBottom: "8px", marginBottom: "12px" }}>
              <strong style={{ fontFamily: "Fredoka, sans-serif", fontSize: "20px", display: "block", color: "#F0196B" }}>
                FaçaAmigos
              </strong>
              <span style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "1px" }}>
                Playground Inclusivo
              </span>
            </div>

            <div style={{ fontSize: "26px", fontWeight: "bold", textAlign: "center", margin: "8px 0", letterSpacing: "2px", background: "#f0f0f0", padding: "4px", borderRadius: "6px" }}>
              #{data.wristbandCode}
            </div>

            <div style={{ margin: "12px 0", display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ fontSize: "13px", color: "#666" }}>Criança:</div>
              <div style={{ fontSize: "18px", fontWeight: "800" }}>{data.childName}</div>
            </div>

            <div style={{ margin: "12px 0", display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ fontSize: "13px", color: "#666" }}>Responsável / WhatsApp:</div>
              <div style={{ fontSize: "14px", fontWeight: "700" }}>
                {data.guardianName} ({data.phone})
              </div>
            </div>

            {data.planName && (
              <div style={{ fontSize: "13px", margin: "8px 0" }}>
                <strong>Plano:</strong> {data.planName}
              </div>
            )}

            <div style={{ fontSize: "13px", margin: "8px 0" }}>
              <strong>Entrada:</strong> {nowStr}
            </div>

            {data.notes && (
              <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px dashed #ccc", fontSize: "12px", color: "#d9534f" }}>
                <strong>⚠️ Cuidados / Tags Sensoriais:</strong>
                <div>{data.notes}</div>
              </div>
            )}

            <div style={{ marginTop: "16px", textAlign: "center", fontSize: "10px", color: "#888" }}>
              Guarde esta pulseira até o checkout.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="primary" onClick={handlePrint}>
            🖨️ Imprimir Pulseira (80mm)
          </Button>
        </div>
      </Card>
    </div>
  );
}
