import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Só as páginas públicas: a apresentação e a entrada do portal.
export default function sitemap(): MetadataRoute.Sitemap {
  const agora = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: agora, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/login`, lastModified: agora, changeFrequency: "yearly", priority: 0.3 },
  ];
}
