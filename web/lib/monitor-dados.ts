import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResumoNotasMonitor } from "./monitor";

type Nota = { org_id: string; cnpj: string; emissao: string | null; situacao: string; valor: number | null };
type ResumoEmpresa = ResumoNotasMonitor & { org_id: string; cnpj: string };

export async function carregarResumoMonitor(supabase: SupabaseClient, agora = new Date()) {
  const [ano, mes] = agora.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).split("-").map(Number);
  const inicio = new Date(Date.UTC(ano, mes - 1, 1, 3));
  const fim = new Date(Date.UTC(ano, mes, 1, 3));
  const { data, error } = await supabase.rpc("xml_nfe_resumo_monitor", { p_inicio: inicio.toISOString(), p_fim: fim.toISOString() });
  if (!error) return new Map(((data ?? []) as ResumoEmpresa[]).map((x) => [`${x.org_id}:${x.cnpj}`, x]));
  if (error.code !== "PGRST202") throw new Error(`Resumo do Monitor Fiscal: ${error.message}`);

  // Compatibilidade com bancos onde a migração ainda está pendente.
  const empresas = new Map<string, ResumoEmpresa>();
  let de = 0;
  for (;;) {
    const { data: notas, error: erroNotas } = await supabase.from("xml_nfe_notas").select("org_id, cnpj, emissao, situacao, valor")
      .order("org_id").order("chave").range(de, de + 499);
    if (erroNotas) throw new Error(`Resumo do Monitor Fiscal: ${erroNotas.message}`);
    if (!notas?.length) return empresas;
    for (const nota of (notas ?? []) as Nota[]) {
      const chave = `${nota.org_id}:${nota.cnpj}`;
      let resumo = empresas.get(chave);
      if (!resumo) {
        resumo = { org_id: nota.org_id, cnpj: nota.cnpj, notasEncontradas: 0, notasMes: 0, comprasMes: 0 };
        empresas.set(chave, resumo);
      }
      resumo.notasEncontradas++;
      const emissao = nota.emissao ? new Date(nota.emissao) : null;
      if (nota.situacao === "autorizada" && emissao && emissao >= inicio && emissao < fim) {
        resumo.notasMes++;
        resumo.comprasMes += Number(nota.valor ?? 0);
      }
    }
    de += notas.length;
  }
}
