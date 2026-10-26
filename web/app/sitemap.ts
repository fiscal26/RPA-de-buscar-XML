import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { ASSUNTOS } from "@/lib/assuntos";

// Só as páginas públicas: a apresentação, as páginas por assunto e a entrada do portal.
export default function sitemap(): MetadataRoute.Sitemap {
  const agora = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: agora, changeFrequency: "monthly", priority: 1 },
    ...ASSUNTOS.map((a) => ({ url: `${SITE_URL}/${a.slug}`, lastModified: agora, changeFrequency: "monthly" as const, priority: 0.8 })),
    { url: `${SITE_URL}/login`, lastModified: agora, changeFrequency: "yearly", priority: 0.3 },
  ];
}
