import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatarDocumento, formatarIe, dataHoraBR } from "@/lib/documentos";
import { NIVEIS, pct } from "@/lib/mei";
import { carregarMeis } from "@/lib/mei-dados";
import { situacaoValidade } from "@/lib/nfse";
import { resumoPainel, type AgendamentoPainel, type TarefaPainel } from "@/lib/painel";

export type Notificacao = {
  id: string;                      // estável: o navegador lembra quais já foram vistas
  tipo: "acao" | "mei" | "certificado" | "robo";
  gravidade: "erro" | "alerta";
  titulo: string;
  texto: string;
  link: string;
  quando: string | null;
};

const ROBO_ONLINE_SEGUNDOS = 120;

/** Tudo o que pede atenção do escritório: empresas que dependem de um ajuste, MEIs perto ou acima do limite,
 *  certificados vencendo e (para o administrador) o robô desligado. Do mais grave ao mais leve. */
export async function carregarNotificacoes(supabase: SupabaseClient, admin: boolean): Promise<Notificacao[]> {
  const ano = new Date().getFullYear();
  const [{ data: agendamentos }, { data: tarefas }, { data: certificados }, meis, robos] = await Promise.all([
    supabase.from("xml_agendamentos").select("id, competencia, criado_em, origem").order("criado_em", { ascending: false }).limit(50),
    supabase.from("xml_tarefas")
      .select("id, agendamento_id, ie, nome, status, mensagem, tipos, detalhes, concluido_em, xml_empresas(xml_acessos(login))")
      .order("criado_em", { ascending: false }).limit(5000),
    supabase.from("xml_nfse_certificados").select("id, nome, cnpj, validade"),
    carregarMeis(supabase, ano).then((r) => r.meis).catch(() => []),
    admin ? supabase.from("xml_robos").select("id, ultimo_sinal").order("ultimo_sinal", { ascending: false }).limit(1).then((r) => r.data ?? [])
          : Promise.resolve([] as { id: string; ultimo_sinal: string }[]),
  ]);
  const lista: Notificacao[] = [];

  const r = resumoPainel((tarefas ?? []) as unknown as TarefaPainel[], (agendamentos ?? []) as AgendamentoPainel[]);
  for (const a of r.acoes) {
    const doc = a.ie.length === 14 ? `CNPJ ${formatarDocumento(a.ie)}` : `IE ${formatarIe(a.ie)}`;
    lista.push({ id: `acao:${a.ie}:${a.quando ?? ""}`, tipo: "acao", gravidade: "erro", titulo: `${a.nome || "Empresa"} precisa da sua ação`,
      texto: `${doc}. ${a.motivo} ${a.oQueFazer}`, link: a.link, quando: a.quando });
  }

  for (const m of meis) {
    for (const medida of ["faturamento", "compras"] as const) {
      const d = m.ano[medida];
      if (!["excedeu20", "excedeu", "atencao", "ritmo"].includes(d.nivel)) continue;
      const n = NIVEIS[d.nivel];
      lista.push({ id: `mei:${m.org}:${m.ie}:${ano}:${medida}:${d.nivel}`, tipo: "mei",
        gravidade: d.nivel === "excedeu20" || d.nivel === "excedeu" ? "erro" : "alerta",
        titulo: `MEI ${m.nome || formatarIe(m.ie)}: ${n.nome.toLowerCase()}`,
        texto: `${medida === "faturamento" ? "Faturamento" : "Compras"} em ${pct(d.pct)} do limite de ${ano}. Mantida a média, chega a ${pct(d.projecao / d.limite)} em dezembro.`,
        link: `/painel/mei/${m.ie}?ano=${ano}`, quando: null });
    }
  }

  for (const c of certificados ?? []) {
    const s = situacaoValidade(c.validade as string | null);
    if (s.classe !== "st-erro" && s.classe !== "st-alerta") continue;
    lista.push({ id: `certificado:${c.id}:${s.nome}`, tipo: "certificado", gravidade: s.vencido ? "erro" : "alerta",
      titulo: `Certificado ${s.vencido ? "vencido" : "vencendo"}: ${(c.nome as string) || formatarDocumento(c.cnpj as string)}`,
      texto: `${s.nome}. Envie o certificado renovado em Certificados para a NFS-e continuar baixando.`,
      link: "/painel/certificados", quando: (c.validade as string | null) ?? null });
  }

  const robo = robos[0];
  if (admin && !(robo && Date.now() - Date.parse(robo.ultimo_sinal) < ROBO_ONLINE_SEGUNDOS * 1000)) {
    lista.push({ id: `robo:${robo?.ultimo_sinal ?? "nunca"}`, tipo: "robo", gravidade: "alerta",
      titulo: robo ? "Robô desligado" : "O robô ainda não se conectou",
      texto: robo ? `Último sinal em ${dataHoraBR(robo.ultimo_sinal)}. Só o administrador vê este aviso.` : "Só o administrador vê este aviso.",
      link: "/painel/agendamentos", quando: robo?.ultimo_sinal ?? null });
  }

  const peso = (n: Notificacao) => (n.gravidade === "erro" ? 0 : 1);
  return lista.sort((a, b) => peso(a) - peso(b) || (b.quando ?? "").localeCompare(a.quando ?? ""));
}
