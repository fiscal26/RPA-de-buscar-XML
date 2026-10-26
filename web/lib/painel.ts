import { SITUACOES_ABERTAS, expandirTipos, nomeTipo, situacaoTarefa } from "@/lib/xml";

/** Uma empresa num agendamento (linha de xml_tarefas), com o login do ATF dela. */
export type TarefaPainel = {
  id: string; agendamento_id: string; ie: string; nome: string; status: string; mensagem: string; tipos: string[];
  detalhes: Record<string, { situacao?: string; mensagem?: string }>; concluido_em: string | null;
  xml_empresas?: { xml_acessos?: { login: string } | null } | null;
};
export type AgendamentoPainel = { id: string; competencia: string; criado_em: string; origem?: string };

/** O que o cliente precisa fazer para destravar uma empresa. */
export type Acao = { ie: string; nome: string; motivo: string; oQueFazer: string; link: string; botao: string; quando: string | null };

const IE_RECUSADA = /n[aã]o encontrou a ie|n[aã]o aceitou a ie|inscri[cç][aã]o estadual|\bie\b.*(inv[aá]lid|n[aã]o encontr)/i;

/** Classifica os problemas que dependem do cliente: senha do ATF, SEFAZ fora do ar, IE errada. */
function acaoDe(t: TarefaPainel): Omit<Acao, "ie" | "nome" | "quando"> | null {
  if (t.status === "senha_invalida") {
    const login = t.xml_empresas?.xml_acessos?.login;
    return { motivo: `O ATF recusou o login${login ? ` ${login}` : ""}.`,
      oQueFazer: "Envie a planilha de novo com a senha atual desse login.", link: "/painel/agendar", botao: "Atualizar a senha" };
  }
  const nfse = t.tipos.some((tipo) => tipo.startsWith("nfse"));
  if (t.status === "certificado") {
    return { motivo: t.mensagem || "O certificado A1 da empresa está ausente, vencido ou foi recusado.",
      oQueFazer: "Envie o certificado A1 atual da empresa (ou da matriz) e agende de novo.", link: "/painel/certificados", botao: "Enviar o certificado" };
  }
  if (t.status === "fora_do_ar") {
    return { motivo: nfse ? "O Portal Nacional da NFS-e estava fora do ar ou instável." : "A SEFAZ estava fora do ar ou instável.",
      oQueFazer: "Agende essa competência de novo daqui a algumas horas.", link: "/painel/agendar", botao: "Agendar de novo" };
  }
  const tipos = expandirTipos(t.tipos);
  const erros = tipos.map((tipo) => ({ tipo, ...situacaoTarefa(t, tipo) })).filter((s) => s.chave === "erro");
  const ie = erros.find((e) => IE_RECUSADA.test(e.mensagem));
  if (ie) {
    return { motivo: "O ATF não encontrou a inscrição estadual.",
      oQueFazer: "Confira a IE na planilha e agende de novo.", link: "/painel/agendar", botao: "Corrigir a planilha" };
  }
  if (erros.length && t.status !== "pendente" && t.status !== "processando") {
    return { motivo: `${erros.map((e) => nomeTipo(e.tipo)).join(", ")} não ${erros.length > 1 ? "saíram" : "saiu"}.`,
      oQueFazer: "Agende de novo. Se o erro se repetir, fale com a LotiVisse.", link: "/painel/agendar", botao: "Agendar de novo" };
  }
  return null;
}

/** Números do painel inicial (o mesmo jeito de contar da página do agendamento). */
export function resumoPainel(tarefas: TarefaPainel[], agendamentos: AgendamentoPainel[]) {
  let realizadas = 0, erros = 0, abertas = 0;
  const porAgendamento = new Map<string, { empresas: Set<string>; ok: Set<string>; realizadas: number; erros: number; abertas: number; acoes: number }>();
  for (const a of agendamentos) porAgendamento.set(a.id, { empresas: new Set(), ok: new Set(), realizadas: 0, erros: 0, abertas: 0, acoes: 0 });
  // última execução de cada empresa: é ela que diz se a empresa está em dia ou precisa de ação
  const ordem = new Map(agendamentos.map((a, i) => [a.id, i]));  // 0 = mais recente
  const ultima = new Map<string, TarefaPainel>();
  for (const t of tarefas) {
    const g = porAgendamento.get(t.agendamento_id);
    let erroDaEmpresa = false, abertaDaEmpresa = false;
    for (const tipo of expandirTipos(t.tipos)) {
      const { chave } = situacaoTarefa(t, tipo);
      if (chave === "cancelado") continue;
      if (SITUACOES_ABERTAS.includes(chave)) { abertas++; abertaDaEmpresa = true; if (g) g.abertas++; }
      else if (chave === "erro") { erros++; erroDaEmpresa = true; if (g) g.erros++; }
      else { realizadas++; if (g) g.realizadas++; }
    }
    if (t.status === "senha_invalida" || t.status === "fora_do_ar" || t.status === "certificado") erroDaEmpresa = true;
    if (g && t.status !== "cancelado") {
      g.empresas.add(t.ie);
      if (!erroDaEmpresa && !abertaDaEmpresa) g.ok.add(t.ie);
      if (acaoDe(t)) g.acoes++;
    }
    const atual = ultima.get(t.ie);
    if (t.status !== "cancelado" && (!atual || (ordem.get(t.agendamento_id) ?? 99) < (ordem.get(atual.agendamento_id) ?? 99))) ultima.set(t.ie, t);
  }
  const acoes: Acao[] = [];
  let empresasOk = 0, processadas = 0;
  for (const t of ultima.values()) {
    if (t.status === "pendente" || t.status === "processando") continue;
    processadas++;
    const a = acaoDe(t);
    if (a) acoes.push({ ie: t.ie, nome: t.nome, quando: t.concluido_em, ...a });
    else empresasOk++;
  }
  const finalizadas = realizadas + erros;
  return {
    empresasProcessadas: processadas, empresasOk, acoes,
    agendamentos: agendamentos.length, realizadas, erros, abertas,
    taxa: finalizadas ? Math.round((realizadas / finalizadas) * 100) : null,
    execucoes: agendamentos.map((a) => {
      const g = porAgendamento.get(a.id)!;
      const fim = g.realizadas + g.erros;
      return { ...a, empresas: g.empresas.size, ok: g.ok.size, realizadas: g.realizadas, abertas: g.abertas, acoes: g.acoes,
        taxa: fim ? Math.round((g.realizadas / fim) * 100) : null };
    }),
  };
}
