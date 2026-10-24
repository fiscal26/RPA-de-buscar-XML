// Endereço público do portal (links dos e-mails, sitemap, compartilhamento). Na Vercel: NEXT_PUBLIC_SITE_URL.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://xml.lotivisse.com.br").replace(/\/$/, "");
export const DESCRICAO =
  "Robô que baixa do ATF da SEFAZ-PB os XMLs de NF-e, NFC-e e CT-e, faturas, extratos, certidões e o faturamento dos MEIs, organizados por empresa e competência, para escritórios contábeis da Paraíba.";
