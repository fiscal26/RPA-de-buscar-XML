import { type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { contexto } from "@/lib/sessao";

// Última planilha usada pelo escritório (SEFAZ ou NFS-e): a do agendamento mais recente dessa origem.
export async function GET(request: NextRequest) {
  const origem = request.nextUrl.searchParams.get("origem") === "nfse" ? "nfse" : "sefaz";
  const { supabase } = await contexto();
  const { data } = await supabase.from("xml_agendamentos").select("id").eq("origem", origem)
    .order("criado_em", { ascending: false }).limit(1).maybeSingle();
  redirect(data ? `/painel/agendamentos/${data.id}/planilha` : `/painel/agendar${origem === "nfse" ? "?origem=nfse" : ""}`);
}
