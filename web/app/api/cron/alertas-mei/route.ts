import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { verificarAlertasMei } from "@/lib/alertas-mei";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Chamado todo dia pela Vercel (vercel.json > crons), com o CRON_SECRET no cabeçalho Authorization.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  const recebido = Buffer.from(request.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${segredo ?? ""}`);
  // comparação em tempo constante: não dá para descobrir o segredo pelo tempo de resposta
  if (!segredo || recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const resumo = await verificarAlertasMei();
  return NextResponse.json({ ...resumo, erros: resumo.erros.slice(0, 20) });
}
