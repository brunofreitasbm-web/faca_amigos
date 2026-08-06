import type { Metadata } from "next";
import "@facaamigos/ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "FaçaAmigos — Back-office",
  description: "Administração em nuvem do FaçaAmigos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
