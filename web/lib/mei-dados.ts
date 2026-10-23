import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analisarAno, type Ajuste, type AnoMei, type MesAtf } from "@/lib/mei";

export type MeiCarteira = { org: string; ie: string; nome: string; ano: AnoMei; ajustes: Ajuste[]; meses: MesAtf[] };
type TarefaMei = { org_id: string; ie: string; nome: string; concluido_em: string | null;
  detalhes: { mei?: { saidas?: number | null; entradas?: number | null; cartao?: number | null; sem_movimento?: boolean; limite_ano?: number } } | null;
  xml_agendamentos: { competencia: string } | { competencia: string }[] | null };

/**
 * MEIs do ano: os que têm Dossiê MEI consultado e os marcados como MEI na planilha (ainda sem consulta).
 * Com `ie`, só aquele MEI. Ordem: maior faturamento no ano primeiro. `erros`: consultas que o banco recusou
 * (por exemplo, schema.sql ainda não atualizado).
 */
export async function carregarMeis(supabase: SupabaseClient, ano: number, ie?: string): Promise<{ meis: MeiCarteira[]; erros: string[] }> {
  const de = `${ano}-01-01`, ate = `${ano}-12-01`;
  let qMeses = supabase.from("xml_mei_meses")
    .select("org_id, ie, nome, competencia, saidas, entradas, qtd_saidas, qtd_entradas, cartao, qtd_cartao, sem_movimento, simei, inicio_atividade, itens, consultado_em")
    .gte("competencia", de).lte("competencia", ate).limit(10000);
  let qAjustes = supabase.from("xml_mei_ajustes").select("id, org_id, ie, competencia, tipo, descricao, valor, criado_em")
    .gte("competencia", de).lte("competencia", ate).order("criado_em").limit(10000);
  let qEmpresas = supabase.from("xml_empresas").select("org_id, ie, nome").contains("tipos", ["mei"]).limit(5000);
  if (ie) {
    qMeses = qMeses.eq("ie", ie);
    qAjustes = qAjustes.eq("ie", ie);
    qEmpresas = qEmpresas.eq("ie", ie);
  }
  // execuções do Dossiê MEI: cobrem o mês que ainda não chegou em xml_mei_meses (robô antigo ou falha no envio)
  let qTarefas = supabase.from("xml_tarefas").select("org_id, ie, nome, detalhes, concluido_em, xml_agendamentos!inner(competencia)")
    .contains("tipos", ["mei"]).gte("xml_agendamentos.competencia", de).lte("xml_agendamentos.competencia", ate)
    .order("concluido_em", { ascending: true }).limit(5000);
  if (ie) qTarefas = qTarefas.eq("ie", ie);
  const [rMeses, rAjustes, rEmpresas, rTarefas] = await Promise.all([qMeses, qAjustes, qEmpresas, qTarefas]);
  const erros = [rMeses, rAjustes, rEmpresas, rTarefas].map((r) => r.error?.message).filter(Boolean) as string[];
  const meses = rMeses.data, ajustes = rAjustes.data, empresas = rEmpresas.data;

  const chave = (o: string, i: string) => `${o}|${i}`;
  const grupos = new Map<string, { org: string; ie: string; nome: string; meses: MesAtf[]; ajustes: Ajuste[] }>();
  const grupo = (o: string, i: string, nome: string) => {
    const k = chave(o, i);
    if (!grupos.has(k)) grupos.set(k, { org: o, ie: i, nome, meses: [], ajustes: [] });
    const g = grupos.get(k)!;
    if (nome && !g.nome) g.nome = nome;
    return g;
  };
  for (const e of empresas ?? []) grupo(e.org_id, e.ie, e.nome);
  for (const m of (meses ?? []) as MesAtf[]) grupo(m.org_id, m.ie, m.nome).meses.push({ ...m, saidas: num(m.saidas), entradas: num(m.entradas), cartao: num(m.cartao) });
  for (const a of (ajustes ?? []) as Ajuste[]) grupo(a.org_id, a.ie, "").ajustes.push({ ...a, valor: Number(a.valor) });
  for (const t of (rTarefas.data ?? []) as TarefaMei[]) {
    const d = t.detalhes?.mei;
    const ag = Array.isArray(t.xml_agendamentos) ? t.xml_agendamentos[0] : t.xml_agendamentos;
    if (!d || !ag?.competencia || (d.saidas == null && d.entradas == null && d.cartao == null && !d.sem_movimento)) continue;
    const g = grupo(t.org_id, t.ie, t.nome);
    const competencia = ag.competencia.slice(0, 10);
    if (g.meses.some((m) => m.competencia.slice(0, 10) === competencia && m.origem !== "execucao")) continue;
    g.meses = g.meses.filter((m) => m.competencia.slice(0, 10) !== competencia);  // a execução mais nova vale
    // limite proporcional do ano de abertura: R$ 6.750 por mês de atividade
    const ativos = d.limite_ano && d.limite_ano < 81000 ? Math.round(d.limite_ano / 6750) : 12;
    const inicio = ativos < 12 ? `${ano}-${String(13 - ativos).padStart(2, "0")}-01` : null;
    g.meses.push({ org_id: t.org_id, ie: t.ie, nome: t.nome, competencia, saidas: num(d.saidas), entradas: num(d.entradas),
      qtd_saidas: null, qtd_entradas: null, cartao: num(d.cartao), qtd_cartao: null, sem_movimento: d.sem_movimento ?? null,
      simei: null, inicio_atividade: inicio, itens: [], consultado_em: t.concluido_em, origem: "execucao" });
  }

  // maior faturamento primeiro
  const meis = [...grupos.values()]
    .map((g) => ({ ...g, ano: analisarAno(ano, g.meses, g.ajustes) }))
    .sort((a, b) => b.ano.faturamento.total - a.ano.faturamento.total || b.ano.compras.total - a.ano.compras.total
      || a.nome.localeCompare(b.nome));
  return { meis, erros };
}

// o PostgREST devolve numeric como texto
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
