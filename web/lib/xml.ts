// Serviços do robô (as colunas da planilha modelo) e situações das tarefas — os mesmos do banco e do robô.

export const TIPOS = [
  { id: "nfe_saida", nome: "NF-e Saída", coluna: "nfe saida" },
  { id: "nfe_entrada", nome: "NF-e Entrada", coluna: "nfe entrada" },
  { id: "nfce", nome: "NFC-e", coluna: "nfce" },
  { id: "cte", nome: "CT-e", coluna: "cte" },
  { id: "faturas", nome: "Faturas", coluna: "download faturas" },
  { id: "extrato", nome: "Extrato de Pagamentos", coluna: "extrato de pagamentos" },
  { id: "omissao", nome: "Omissão e Inadimplência", coluna: "omissao e inadimplencia" },
  { id: "certidao", nome: "Certidão de Débitos", coluna: "certidao de debitos" },
  { id: "cartao", nome: "Conferência Cartão de Crédito", coluna: "conferencia cartao de credito" },
  { id: "mei", nome: "Dossiê MEI", coluna: "dossie mei" },
] as const;
export const IDS_TIPOS: string[] = TIPOS.map((t) => t.id);

// Serviços do Portal Nacional da NFS-e (planilha modelo da NFS-e), pela API oficial com o certificado A1
export const TIPOS_NFSE = [
  { id: "nfse_emitidas", nome: "NFS-e Emitidas", coluna: "nfse emitidas" },
  { id: "nfse_recebidas", nome: "NFS-e Recebidas", coluna: "nfse recebidas" },
  { id: "nfse_pdf", nome: "PDF (DANFSe)", coluna: "pdf danfse" },
  { id: "nfse_retencoes", nome: "Relatório de Retenções", coluna: "relatorio de retencoes" },
] as const;
export const IDS_TIPOS_NFSE: string[] = TIPOS_NFSE.map((t) => t.id);
export type Origem = "sefaz" | "nfse";

// Uma coluna da planilha pode virar mais de uma tarefa no robô (CT-e: como remetente e como destinatária)
export const SUBTIPOS: Record<string, string[]> = { cte: ["cte_rem", "cte_dest"] };
const NOMES_TAREFAS: Record<string, string> = { cte_rem: "CT-e Remetente", cte_dest: "CT-e Destinatário" };
export const nomeTipo = (id: string) =>
  TIPOS.find((t) => t.id === id)?.nome ?? TIPOS_NFSE.find((t) => t.id === id)?.nome ?? NOMES_TAREFAS[id] ?? id;
export const expandirTipos = (tipos: string[]) => tipos.flatMap((t) => SUBTIPOS[t] ?? [t]);
/** Ordem das tarefas nas tabelas (a mesma das colunas da planilha). */
export const ORDEM_TAREFAS = [...TIPOS.flatMap((t) => SUBTIPOS[t.id] ?? [t.id]), ...IDS_TIPOS_NFSE];

/** Situação de cada tarefa (empresa x serviço), gravada pelo robô à medida que avança. */
export const SITUACAO: Record<string, { nome: string; classe: string }> = {
  fila: { nome: "Na fila", classe: "st-neutro" },
  andamento: { nome: "Em andamento", classe: "st-fila st-vivo" },
  aguardando: { nome: "Aguardando o ATF", classe: "st-alerta" },
  concluido: { nome: "Concluído", classe: "st-ok" },
  sem_movimento: { nome: "Sem movimento", classe: "st-calmo" },
  erro: { nome: "Erro", classe: "st-erro" },
  cancelado: { nome: "Cancelado", classe: "st-neutro" },
};
export const SITUACOES_ABERTAS = ["fila", "andamento", "aguardando"];

type TarefaBase = { status: string; mensagem?: string; detalhes?: Record<string, { situacao?: string; mensagem?: string;
  arquivos?: number; repetidos?: number; sem_notas?: boolean }> };

/** Situação de um serviço de uma empresa: a que o robô gravou, ou a deduzida da situação da empresa. */
export function situacaoTarefa(t: TarefaBase, tipo: string): { chave: string; mensagem: string } {
  const d = t.detalhes?.[tipo];
  const emCurso = t.status === "pendente" || t.status === "processando";
  // a empresa já terminou, mas o serviço ficou "fazendo/aguardando": a execução parou no meio
  if (d?.situacao && (emCurso || !SITUACOES_ABERTAS.includes(d.situacao))) return { chave: d.situacao, mensagem: d.mensagem ?? "" };
  if (emCurso) return { chave: "fila", mensagem: "" };
  if (t.status === "cancelado") return { chave: "cancelado", mensagem: "" };
  if (d && ((d.arquivos ?? 0) > 0 || (d.repetidos ?? 0) > 0)) return { chave: "concluido", mensagem: "" };
  if (d?.sem_notas || t.status === "sem_notas") return { chave: "sem_movimento", mensagem: "" };
  return { chave: "erro", mensagem: motivoDoTipo(t, tipo) };
}

const XML = ["nfe_saida", "nfe_entrada", "nfce", "cte_rem", "cte_dest"];

/** Só o pedaço da mensagem da empresa que fala deste serviço (ex.: "Faturas: ..."), nunca o erro inteiro. */
function motivoDoTipo(t: TarefaBase, tipo: string): string {
  const nome = nomeTipo(tipo).toLowerCase();
  const partes = (t.mensagem ?? "").split(/;\s*|\.\s+(?=[A-ZÀ-Ú])/).map((p) => p.trim().replace(/\.$/, "")).filter(Boolean);
  const propria = partes.find((p) => p.toLowerCase().startsWith(`${nome}:`));
  if (propria) return propria.slice(nome.length + 1).trim();
  if (partes.some((p) => p.toLowerCase().includes(nome) && /n[aã]o entregou/i.test(p))) return "o ATF não entregou em Minhas Mensagens";
  if (t.status === "senha_invalida") return "login recusado pelo ATF";
  if (t.status === "certificado") return "certificado A1 ausente, vencido ou recusado";
  if (tipo.startsWith("nfse")) return t.status === "fora_do_ar" ? "Portal Nacional fora do ar; agende de novo mais tarde" : "não foi concluído nesta execução";
  if (t.status === "fora_do_ar") return "ATF fora do ar; agende de novo mais tarde";
  return XML.includes(tipo) ? "o ATF não devolveu o XML" : "não foi concluído nesta execução";
}

export const STATUS: Record<string, { nome: string; classe: string }> = {
  pendente: { nome: "Na fila", classe: "st-fila" },
  processando: { nome: "Em andamento", classe: "st-fila" },
  concluido: { nome: "Concluído", classe: "st-ok" },
  sem_notas: { nome: "Sem movimento", classe: "st-neutro" },
  senha_invalida: { nome: "Login recusado", classe: "st-erro" },
  certificado: { nome: "Certificado", classe: "st-erro" },
  erro: { nome: "Erro", classe: "st-erro" },
  fora_do_ar: { nome: "Fora do ar", classe: "st-alerta" },
  cancelado: { nome: "Cancelado", classe: "st-neutro" },
};
export const EM_ANDAMENTO = ["pendente", "processando"];
