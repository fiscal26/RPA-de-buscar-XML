import "server-only";
import { schemaMeiAusente } from "./mei-acompanhamento";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatarDocumento } from "@/lib/documentos";

type Deteccao = { org_id: string; ie: string; nome: string; concluido_em: string | null };
type Cadastro = { org_id: string; cnpj: string };
type Empresa = Cadastro & { nome: string };

// Leituras completas e ordenadas: não perder sugestões/cadastros após o limite de resposta do banco.
async function lerTodas<T>(consulta: { range: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { code?: string } | null }> }) {
  const itens: T[] = [];
  for (let de = 0; ; de += 500) {
    const { data, error } = await consulta.range(de, de + 499);
    if (error) return schemaMeiAusente(error) ? [] : null;
    itens.push(...(data ?? []));
    if (!data || data.length < 500) return itens;
  }
}

export function lembretesCadastroMei(deteccoes: Deteccao[], cadastros: Cadastro[], empresas: Empresa[], podeCadastrar = true) {
  const chave = (org: string, cnpj: string) => `${org}|${cnpj}`;
  const cadastradas = new Set(cadastros.map((c) => chave(c.org_id, c.cnpj)));
  const disponiveis = new Map(empresas.map((e) => [chave(e.org_id, e.cnpj), e]));
  const pendentes = new Map<string, Deteccao>();
  for (const d of deteccoes) {
    const k = chave(d.org_id, d.ie);
    if (!/^\d{14}$/.test(d.ie) || cadastradas.has(k) || !disponiveis.has(k)) continue;
    const anterior = pendentes.get(k);
    if (!anterior || (d.concluido_em ?? "") > (anterior.concluido_em ?? "")) pendentes.set(k, d);
  }
  return [...pendentes].map(([k, d]) => ({
    id: `mei-cadastro:${k}`, tipo: "mei" as const, gravidade: "alerta" as const,
    titulo: `Possível MEI: ${disponiveis.get(k)?.nome || d.nome || formatarDocumento(d.ie)}`,
    texto: `CNPJ ${formatarDocumento(d.ie)}. Uma NFS-e indicou possível enquadramento MEI. ${podeCadastrar ? "Confirme o enquadramento e cadastre a empresa no Monitoramento MEI." : "Peça ao gestor para confirmar o enquadramento e cadastrar a empresa no Monitoramento MEI."}`,
    link: podeCadastrar ? `/painel/empresas?mei=${encodeURIComponent(k)}#cadastro-mei` : "/painel/empresas", quando: d.concluido_em,
  }));
}

export async function carregarLembretesCadastroMei(supabase: SupabaseClient, podeCadastrar = true) {
  const deteccoes = await lerTodas(supabase.from("xml_tarefas").select("org_id, ie, nome, concluido_em")
    .contains("detalhes", { mei_nfse: { detectado_no_xml: true } }).order("org_id").order("ie").order("id"));
  if (!deteccoes?.length) return [];
  const [cadastros, sefaz, nfse, decisoes] = await Promise.all([
    lerTodas(supabase.from("xml_mei_cadastros").select("org_id, cnpj").order("org_id").order("cnpj")),
    lerTodas(supabase.from("xml_empresas").select("org_id, cnpj, nome").order("org_id").order("id")),
    lerTodas(supabase.from("xml_nfse_empresas").select("org_id, cnpj, nome").order("org_id").order("id")),
    lerTodas(supabase.from("xml_mei_acompanhamento").select("org_id, cnpj").order("org_id").order("cnpj")),
  ]);
  // Uma falha ao ler cadastros não pode gerar lembretes incorretos de cadastro ausente.
  if (!cadastros || !sefaz || !nfse || !decisoes) return [];
  return lembretesCadastroMei(deteccoes, [...cadastros, ...(decisoes ?? [])], [...nfse, ...sefaz], podeCadastrar);
}
