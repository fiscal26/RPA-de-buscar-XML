import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "LotiVisse XML", short_name: "LotiVisse", lang: "pt-BR",
    description: "Agende competências e acompanhe os documentos fiscais do seu escritório.",
    start_url: "/painel", scope: "/", display: "standalone", background_color: "#fbfcfd", theme_color: "#13294b",
    icons: [
      { src: "/icons/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/app-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Agendar competência", url: "/painel/agendar" },
      { name: "Acompanhar agendamentos", url: "/painel/agendamentos" },
      { name: "Monitor Fiscal", url: "/painel/monitor" },
    ],
  };
}
