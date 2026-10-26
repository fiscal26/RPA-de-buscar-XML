import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = { themeColor: "#13294B" };

// Antes de pintar a página: o tema escolhido (guardado no navegador) ou o do sistema, sem piscar.
const TEMA_INICIAL = `try{var t=localStorage.getItem("tema");if(t!=="claro"&&t!=="escuro")t=matchMedia("(prefers-color-scheme: dark)").matches?"escuro":"claro";document.documentElement.dataset.tema=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA_INICIAL }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
