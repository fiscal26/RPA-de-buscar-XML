import type { Metadata, Viewport } from "next";
import "./fontes.css";
import "./globals.css";
import { DESCRICAO, SITE_URL, TITULO } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITULO, template: "%s | LotiVisse" },
  description: DESCRICAO,
  applicationName: "LotiVisse",
  keywords: ["robô para baixar nota fiscal", "robô de capturar XML", "baixar XML de notas fiscais", "download automático de XML",
    "captura de XML NF-e", "XML NF-e", "NFC-e", "CT-e", "NFS-e", "baixar NFS-e em lote", "Portal Nacional da NFS-e",
    "relatório de retenções NFS-e", "SEFAZ", "ATF SEFAZ-PB", "certidão negativa de débitos",
    "faturamento MEI", "limite do MEI", "robô contábil", "automação para escritório contábil", "RPA contábil", "LotiVisse"],
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "pt_BR", siteName: "LotiVisse", url: SITE_URL, title: TITULO, description: DESCRICAO },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRICAO },
  robots: { index: true, follow: true },
  // Google Search Console: código da verificação por meta tag (variável na Vercel)
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } } : {}),
  category: "business",
};

export const viewport: Viewport = { themeColor: "#181b1c" };

// O tema escolhido é aplicado antes da primeira pintura.
const TEMA_INICIAL = `try{if(localStorage.getItem("tema")==="claro")document.documentElement.dataset.tema="claro"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-tema="escuro" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA_INICIAL }} />
        <link rel="preload" href="/fontes/ibm-plex-sans-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
