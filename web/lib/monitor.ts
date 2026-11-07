// Monitor Fiscal: textos e regras que o portal usa (a fila e a gravação ficam no banco: xml_nfe_*).

export type MonitorLinha = {
  id: string; org_id: string; cnpj: string; nome: string; codigo: string; ciencia: boolean; ativo: boolean;
  status: string; mensagem: string; proxima_consulta: string; ultima_consulta: string | null; ultima_nota_em: string | null;
  organizacoes?: { nome: string } | null;
};

export const SITUACAO_MONITOR: Record<string, { nome: string; classe: string }> = {
  fila: { nome: "Na fila", classe: "st-neutro" },
  processando: { nome: "Consultando", classe: "st-fila st-vivo" },
  ok: { nome: "Em dia", classe: "st-ok" },
  erro: { nome: "Erro", classe: "st-erro" },
  certificado: { nome: "Certificado", classe: "st-erro" },
};

export const SITUACAO_NOTA: Record<string, { nome: string; classe: string }> = {
  autorizada: { nome: "Autorizada", classe: "st-ok" },
  cancelada: { nome: "Cancelada", classe: "st-erro" },
  denegada: { nome: "Denegada", classe: "st-erro" },
};

// UFs atendidas pelo Ambiente Nacional da NF-e nas notas destinadas (todas: a nota de qualquer estado chega)
export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI",
  "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

export const reaisMonitor = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "11:00:00" -> "11h"; "07:30" -> "7h30" (horário de Brasília da consulta diária). */
export const horaBR = (h: string | null | undefined) => {
  const [hh, mm] = (h || "11:00").slice(0, 5).split(":");
  return mm === "00" ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
};
