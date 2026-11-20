import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MonitorLinha, ResumoNotasMonitor } from "./monitor";

type Nota = { org_id: string; cnpj: string; emissao: string | null; situacao: string; valor: number | null };
type ResumoEmpresa = ResumoNotasMonitor & { org_id: string; cnpj: string };

export async function carregarEmpresasMonitor(supabase: SupabaseClient): Promise<MonitorLinha[]> {
  const consulta = supabase.from("xml_nfe_monitor")
    .select("id, org_id, cnpj, nome, codigo, ciencia, ativo, status, mensagem, proxima_consulta, ultima_consulta, ultima_nota_em, organizacoes(nome)")
    .order("ultima_nota_em", { ascending: false, nullsFirst: false }).order("nome").order("id");
  const empresas: MonitorLinha[] = [];
  for (;;) {
    const { data, error } = await consulta.range(empresas.length, empresas.length + 499);
    if (error) throw new Error(`Empresas do Monitor Fiscal: ${error.message}`);
    if (!data?.length) return empresas;
    empresas.push(...data as unknown as MonitorLinha[]);
  }
}

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
