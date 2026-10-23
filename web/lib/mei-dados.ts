import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analisarAno, NIVEIS, type Ajuste, type AnoMei, type MesAtf } from "@/lib/mei";

export type MeiCarteira = { org: string; ie: string; nome: string; ano: AnoMei; ajustes: Ajuste[]; meses: MesAtf[] };

/**
 * MEIs do ano: os que têm Dossiê MEI consultado e os marcados como MEI na planilha (ainda sem consulta).
 * Com `ie`, só aquele MEI. Ordem: mais arriscado primeiro.
 */
export async function carregarMeis(supabase: SupabaseClient, ano: number, ie?: string): Promise<MeiCarteira[]> {
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
  const [{ data: meses }, { data: ajustes }, { data: empresas }] = await Promise.all([qMeses, qAjustes, qEmpresas]);

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

  return [...grupos.values()]
    .map((g) => ({ ...g, ano: analisarAno(ano, g.meses, g.ajustes) }))
    .sort((a, b) => NIVEIS[b.ano.nivel].peso - NIVEIS[a.ano.nivel].peso
      || Math.max(b.ano.faturamento.pct, b.ano.compras.pct) - Math.max(a.ano.faturamento.pct, a.ano.compras.pct)
      || a.nome.localeCompare(b.nome));
}

// o PostgREST devolve numeric como texto
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
