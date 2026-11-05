import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { verificarAlertasMei } from "@/lib/alertas-mei";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Chamado pelo robô logo depois de gravar o Dossiê MEI de uma empresa: a equipe recebe o alerta de limite na hora,
// sem esperar o agendamento diário. O robô se identifica com a mesma chave secreta do Supabase que ele já usa.
export async function POST(request: NextRequest) {
  const segredo = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const recebido = Buffer.from(request.headers.get("x-robo-chave") ?? "");
  const esperado = Buffer.from(segredo);
  if (!segredo || recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const { ie } = (await request.json().catch(() => ({}))) as { ie?: string };
  const so = String(ie ?? "").replace(/\D/g, "");
  if (!so) return NextResponse.json({ erro: "informe a IE" }, { status: 400 });
  const resumo = await verificarAlertasMei({ ie: so });
  return NextResponse.json({ ...resumo, erros: resumo.erros.slice(0, 20) });
}
