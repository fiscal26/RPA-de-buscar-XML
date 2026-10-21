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
] as const;
export const IDS_TIPOS: string[] = TIPOS.map((t) => t.id);
export const nomeTipo = (id: string) => TIPOS.find((t) => t.id === id)?.nome ?? id;

export const STATUS: Record<string, { nome: string; classe: string }> = {
  pendente: { nome: "Na fila", classe: "st-fila" },
  processando: { nome: "Baixando…", classe: "st-fila" },
  concluido: { nome: "Arquivos salvos", classe: "st-ok" },
  sem_notas: { nome: "Sem notas", classe: "st-neutro" },
  senha_invalida: { nome: "Login recusado", classe: "st-erro" },
  erro: { nome: "Erro", classe: "st-erro" },
  fora_do_ar: { nome: "ATF fora do ar", classe: "st-alerta" },
  cancelado: { nome: "Cancelado", classe: "st-neutro" },
};
export const EM_ANDAMENTO = ["pendente", "processando"];
