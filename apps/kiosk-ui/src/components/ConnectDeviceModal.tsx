import { Modal, Button, Tag, HelpText } from "@facaamigos/ui";
import { WristbandQRCode } from "./WristbandQRCode.js";

interface ConnectDeviceModalProps {
  onClose: () => void;
}

/**
 * Pareamento de celular/tablet por QR Code (substitui o antigo modal de
 * "Impressão Wi-Fi" que mandava o operador digitar IP na mão).
 *
 * O QR aponta para a versão web publicada (HTTPS) — é ela que o celular
 * instala como app (PWA); no aparelho, o InstallPwaBanner assume e guia o
 * "Adicionar à Tela de Início". A operação móvel fala direto com a nuvem;
 * as impressões continuam saindo na impressora do computador do balcão.
 */
export function ConnectDeviceModal({ onClose }: ConnectDeviceModalProps) {
  // URL pública de produção (Vercel). Configurada via env no build; se a
  // página atual já está num domínio público (não-local), ele serve.
  const envUrl = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  const isLocalOrigin = ["127.0.0.1", "localhost"].includes(window.location.hostname);
  const appUrl = envUrl ?? (isLocalOrigin ? undefined : window.location.origin);

  return (
    <Modal
      title={
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>📱</span> Conectar celular ou tablet
        </span>
      }
      onClose={onClose}
      maxWidth="600px"
      zIndex={9999}
      bodyStyle={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      {appUrl ? (
        <div
          style={{
            display: "flex",
            gap: "18px",
            alignItems: "center",
            background: "rgba(46, 207, 181, 0.08)",
            border: "1px solid var(--color-teal)",
            borderRadius: "14px",
            padding: "16px",
          }}
        >
          <WristbandQRCode value={appUrl} size={148} style={{ borderRadius: "10px", padding: "6px" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
            <Tag color="var(--color-teal)">Passo a passo</Tag>
            <ol style={{ margin: 0, paddingLeft: "18px", fontSize: "14px", lineHeight: 1.6 }}>
              <li>Aponte a câmera do celular/tablet para o QR Code;</li>
              <li>Abra o link — o sistema carrega direto no navegador;</li>
              <li>
                Toque em <strong>Instalar</strong> (ou <strong>Adicionar à Tela de Início</strong> no iPhone/iPad) para
                virar um aplicativo de tela cheia com ícone próprio.
              </li>
            </ol>
            <code style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--color-primary-hover)", wordBreak: "break-all" }}>
              {appUrl}
            </code>
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "var(--surface-sunken)",
            borderRadius: "12px",
            padding: "14px",
            fontSize: "13px",
          }}
        >
          <strong>Endereço público ainda não configurado.</strong>
          <HelpText>
            Defina <code>VITE_PUBLIC_APP_URL</code> (URL do deploy na Vercel) no build para o QR Code de pareamento
            aparecer aqui.
          </HelpText>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <strong style={{ fontSize: "15px" }}>Como funciona a operação móvel:</strong>
        <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "14px", lineHeight: 1.6, color: "var(--text-primary)" }}>
          <li>
            <strong>Entrada e saída pelo celular/tablet:</strong> cadastro, leitura do QR da pulseira e cobrança
            funcionam normalmente — a pulseira, o recibo e o comprovante são impressos automaticamente na impressora do
            computador do balcão.
          </li>
          <li>
            <strong>Computador do balcão ligado:</strong> ele é o servidor de impressão — mantenha o aplicativo
            FaçaAmigos aberto nele para as impressões saírem.
          </li>
          <li>
            <strong>Internet:</strong> o celular usa a internet normal (Wi-Fi ou dados) — não precisa estar na mesma
            rede do computador.
          </li>
        </ul>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
        <Button variant="primary" onClick={onClose}>
          Entendi
        </Button>
      </div>
    </Modal>
  );
}
