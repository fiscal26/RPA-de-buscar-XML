import { ImageResponse } from "next/og";

// Imagem que aparece quando o link é compartilhado (WhatsApp, LinkedIn, Google).
export const alt = "LotiVisse: robô para baixar notas fiscais e capturar XML";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Imagem() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
        background: "#13294b", color: "#ffffff", padding: "72px 80px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 16, background: "#1d3a66", display: "flex", alignItems: "center",
            justifyContent: "center" }}>
            <svg width="44" height="44" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#f6d35b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 800 }}>Loti<span style={{ color: "#f6d35b" }}>Visse</span></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.1 }}>O robô que baixa as notas fiscais e captura os XMLs, empresa por empresa.</div>
          <div style={{ fontSize: 30, color: "#c9d6ea" }}>NF-e, NFC-e, CT-e e NFS-e, guias, certidões, retenções e faturamento dos MEIs</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#f6d35b" }}>xml.lotivisse.com.br</div>
      </div>
    ),
    size,
  );
}
