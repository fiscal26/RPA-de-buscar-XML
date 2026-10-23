import { NextResponse, type NextRequest } from "next/server";
import { verificarAlertasMei } from "@/lib/alertas-mei";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Chamado todo dia pela Vercel (vercel.json > crons), com o CRON_SECRET no cabeçalho Authorization.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const resumo = await verificarAlertasMei();
  return NextResponse.json({ ...resumo, erros: resumo.erros.slice(0, 20) });
}
