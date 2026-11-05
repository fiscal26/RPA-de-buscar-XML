import { NextResponse } from "next/server";
import { contexto } from "@/lib/sessao";
import { carregarNotificacoes } from "@/lib/notificacoes";

export const dynamic = "force-dynamic";

// Avisos do sino da barra do painel (só da organização de quem está logado; o banco confere pelas regras de acesso)
export async function GET() {
  const { supabase, admin } = await contexto();
  const avisos = await carregarNotificacoes(supabase, admin);
  return NextResponse.json({ avisos }, { headers: { "Cache-Control": "no-store" } });
}
