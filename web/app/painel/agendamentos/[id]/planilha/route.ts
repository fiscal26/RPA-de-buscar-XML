import { notFound } from "next/navigation";
import { contexto } from "@/lib/sessao";
import { planilhaDoAgendamento, respostaPlanilha } from "@/lib/planilha-saida";

// Planilha deste agendamento (sem as senhas), para conferir ou enviar de novo.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await contexto();
  const planilha = await planilhaDoAgendamento(supabase, (await params).id);
  if (!planilha) notFound();
  return respostaPlanilha(planilha);
}
