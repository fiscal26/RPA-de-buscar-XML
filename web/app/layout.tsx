import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LotiVisse — XML SEFAZ-PB",
  description: "Download agendado de XML de NF-e e NFC-e no ATF da SEFAZ-PB",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
