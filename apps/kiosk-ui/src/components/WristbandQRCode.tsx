import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface WristbandQRCodeProps {
  value: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function WristbandQRCode({ value, size = 64, className, style }: WristbandQRCodeProps) {
  const [svgHtml, setSvgHtml] = useState<string>("");

  useEffect(() => {
    let active = true;
    if (!value) return;

    QRCode.toString(value, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
    })
      .then((svg) => {
        if (active) {
          setSvgHtml(svg);
        }
      })
      .catch((err) => {
        console.error("Erro ao gerar QR Code:", err);
      });

    return () => {
      active = false;
    };
  }, [value]);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
        background: "#ffffff",
        borderRadius: "4px",
        padding: "2px",
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
}

/**
 * Função utilitária para gerar a string Data URL (Base64) ou SVG de um QR Code,
 * usada na injeção dos HTMLs de impressão do browser e do printBridge Electron.
 */
export async function generateWristbandQRCodeDataUrl(value: string, size = 120): Promise<string> {
  try {
    return await QRCode.toDataURL(value, {
      margin: 1,
      width: size,
      errorCorrectionLevel: "M",
    });
  } catch (err) {
    console.error("Falha ao gerar Data URL do QR code:", err);
    return "";
  }
}

export async function generateWristbandQRCodeSvgString(value: string): Promise<string> {
  try {
    return await QRCode.toString(value, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
    });
  } catch (err) {
    console.error("Falha ao gerar SVG string do QR code:", err);
    return "";
  }
}
