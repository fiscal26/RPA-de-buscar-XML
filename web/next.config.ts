import type { NextConfig } from "next";

const producao = process.env.NODE_ENV === "production";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// O que o navegador pode carregar: só o próprio site, as fontes do Google e o Supabase.
// 'unsafe-inline' nos scripts: o Next e o script do tema claro/escuro vão embutidos na página.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${producao ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${supabase}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(producao ? ["upgrade-insecure-requests"] : []),
].join("; ");

const cabecalhos = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },                       // ninguém põe o portal dentro de outro site
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(producao ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // planilhas de empresas sobem pelo formulário
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [
      { source: "/:caminho*", headers: cabecalhos },
      // páginas com dados do escritório não ficam em cache compartilhado
      { source: "/painel/:caminho*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
