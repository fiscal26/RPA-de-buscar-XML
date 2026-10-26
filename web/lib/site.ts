// Endereço público do portal (links dos e-mails, sitemap, compartilhamento). Na Vercel: NEXT_PUBLIC_SITE_URL.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://xml.lotivisse.com.br").replace(/\/$/, "");
export const TITULO = "LotiVisse — robô para baixar notas fiscais e capturar XML";
export const DESCRICAO =
  "Robô para escritórios contábeis que baixa as notas fiscais e captura os XMLs de NF-e, NFC-e, CT-e e NFS-e, guias, certidões, retenções e o faturamento dos MEIs, organizados por empresa e competência. NFS-e em todo o Brasil pelo Portal Nacional; SEFAZ disponível na Paraíba.";
