import { llmsFullTxt } from "@/lib/llms";

// Gerado na publicação (estático): resumo do site para assistentes de IA.
export const dynamic = "force-static";

export function GET() {
  return new Response(llmsFullTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
