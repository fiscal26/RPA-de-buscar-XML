// Endereço público do portal (links dos e-mails, sitemap, compartilhamento). Na Vercel: NEXT_PUBLIC_SITE_URL.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://xml.lotivisse.com.br").replace(/\/$/, "");
export const TITULO = "LotiVisse — robô para baixar notas fiscais e capturar XML";
export const DESCRICAO =
  "Robô para escritórios contábeis que baixa as notas fiscais e captura os XMLs de NF-e, NFC-e e CT-e, guias, certidões e o faturamento dos MEIs direto da SEFAZ, organizados por empresa e competência. Já disponível na SEFAZ-PB; novos estados e prefeituras entram conforme a demanda.";
