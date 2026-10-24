import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// O Google pode ler a apresentação; a área logada e os links de e-mail ficam fora da busca.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/painel", "/api/", "/auth/", "/sair", "/redefinir-senha", "/esqueci-senha"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
