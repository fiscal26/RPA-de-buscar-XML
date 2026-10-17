// Tipos de XML e situações das tarefas (os mesmos do banco e do robô).

export const TIPOS = [
  { id: "nfe_emitidas", nome: "NF-e emitidas" },
  { id: "nfe_recebidas", nome: "NF-e recebidas" },
  { id: "nfce_emitidas", nome: "NFC-e emitidas" },
] as const;
export const IDS_TIPOS: string[] = TIPOS.map((t) => t.id);
export const nomeTipo = (id: string) => TIPOS.find((t) => t.id === id)?.nome ?? id;

export const STATUS: Record<string, { nome: string; classe: string }> = {
  pendente: { nome: "Na fila", classe: "st-fila" },
  processando: { nome: "Baixando…", classe: "st-fila" },
  concluido: { nome: "XML salvos", classe: "st-ok" },
  sem_notas: { nome: "Sem notas", classe: "st-neutro" },
  senha_invalida: { nome: "Login recusado", classe: "st-erro" },
  erro: { nome: "Erro", classe: "st-erro" },
  fora_do_ar: { nome: "ATF fora do ar", classe: "st-alerta" },
  cancelado: { nome: "Cancelado", classe: "st-neutro" },
};
export const EM_ANDAMENTO = ["pendente", "processando"];
export const MAX_DIAS_PERIODO = 366;
