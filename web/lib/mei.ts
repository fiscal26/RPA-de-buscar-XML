/** Monitoramento de Faturamento MEI: limites do ano, acumulados e sinais de alerta (servidor e navegador). */

export const LIMITE_ANO = 81000;              // LC 123/2006, art. 18-A, § 1º
export const LIMITE_MES = LIMITE_ANO / 12;    // R$ 6.750 por mês (proporcional no ano de abertura, § 2º)
export const FRACAO_COMPRAS = 0.8;            // compras: até 80% do limite de faturamento (R$ 64.800)
export const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
  "setembro", "outubro", "novembro", "dezembro"];

/** Linha de xml_mei_meses (um mês do Dossiê MEI vindo do ATF). */
export type MesAtf = {
  org_id: string; ie: string; nome: string; competencia: string;
  saidas: number | null; entradas: number | null; qtd_saidas: number | null; qtd_entradas: number | null;
  cartao: number | null; qtd_cartao: number | null; sem_movimento: boolean | null; simei: boolean | null;
  inicio_atividade: string | null; itens?: { tipo: string; entradas?: number | null; saidas?: number | null;
    qtd_entradas?: number | null; qtd_saidas?: number | null }[]; consultado_em?: string | null;
  origem?: "atf" | "execucao" | "nfse";
  nfse?: number; consultadoAtf?: boolean; consultadoNfse?: boolean; sobreposicaoIncerta?: boolean;
};
/** Linha de xml_mei_ajustes (lançamento manual do escritório). */
export type Ajuste = { id: string; org_id: string; ie: string; competencia: string; tipo: "receita" | "compra";
  descricao: string; valor: number; criado_em: string };

export type Nivel = "excedeu20" | "excedeu" | "atencao" | "ritmo" | "ok" | "sem_dados";
export const NIVEIS: Record<Nivel, { nome: string; sinal: string; classe: string; peso: number }> = {
  excedeu20: { nome: "Passou mais de 20%", sinal: "!!", classe: "st-erro", peso: 5 },
  excedeu: { nome: "Passou do limite", sinal: "!", classe: "st-erro", peso: 4 },
  atencao: { nome: "Perto do limite", sinal: "!", classe: "st-alerta", peso: 3 },
  ritmo: { nome: "No ritmo de passar", sinal: "↗", classe: "st-alerta", peso: 2 },
  ok: { nome: "Dentro do limite", sinal: "✓", classe: "st-ok", peso: 1 },
  sem_dados: { nome: "Sem consulta ainda", sinal: "·", classe: "st-neutro", peso: 0 },
};

export type Mes = {
  mes: number;                 // 0 = janeiro
  ativo: boolean;              // depois do início da atividade
  consultado: boolean;         // o ATF já foi consultado para esse mês
  notas: number; nfse: number; cartao: number; receitaManual: number; faturamento: number;
  consultadoAtf: boolean; consultadoNfse: boolean; sobreposicaoIncerta: boolean;
  entradas: number; compraManual: number; compras: number;
  semMovimento: boolean; acimaFaturamento: boolean; acimaCompras: boolean;
  faturamentoAcum: number; comprasAcum: number;
};

export type Medida = { total: number; limite: number; pct: number; projecao: number; esperado: number; nivel: Nivel };

const n = (v: number | null | undefined) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);

function nivelDe(total: number, limite: number, projecao: number, temDados: boolean): Nivel {
  if (!temDados) return "sem_dados";
  const pct = total / limite;
  return pct > 1.2 ? "excedeu20" : pct > 1 ? "excedeu" : pct >= 0.8 ? "atencao" : projecao > limite ? "ritmo" : "ok";
}

/**
 * Ano de um MEI. Faturamento do mês = o MAIOR entre notas de saída e cartão (o cartão pode estar ou não dentro
 * das notas) + receitas lançadas à mão. Compras do mês = notas de entrada + compras lançadas à mão.
 */
export function analisarAno(ano: number, meses: MesAtf[], ajustes: Ajuste[], cadastro?: {
  inicio_atividade: string; inicio_mei: string; fim_mei: string | null;
}) {
  const inicio = cadastro?.inicio_atividade || meses.map((m) => m.inicio_atividade).filter(Boolean).sort()[0] || null;
  const primeiroMes = inicio && Number(inicio.slice(0, 4)) === ano ? Number(inicio.slice(5, 7)) - 1 : 0;
  const ativos = 12 - primeiroMes;
  const limiteFat = Math.round(LIMITE_MES * ativos * 100) / 100;
  const limiteCompras = Math.round(limiteFat * FRACAO_COMPRAS * 100) / 100;
  const noPeriodo = (mes: string) => !cadastro || (mes >= cadastro.inicio_mei.slice(0, 7) && (!cadastro.fim_mei || mes <= cadastro.fim_mei.slice(0, 7)));
  const porMes = new Map(meses.filter((m) => m.competencia.startsWith(`${ano}-`) && noPeriodo(m.competencia.slice(0, 7))).map((m) => [Number(m.competencia.slice(5, 7)) - 1, m]));

  let fatAcum = 0, compAcum = 0, ultimo = -1;
  const lista: Mes[] = MESES.map((_, i) => {
    const m = porMes.get(i);
    const ref = `${ano}-${String(i + 1).padStart(2, "0")}`;
    const doMes = ajustes.filter((a) => a.competencia.startsWith(ref) && noPeriodo(ref));
    const receitaManual = doMes.filter((a) => a.tipo === "receita").reduce((s, a) => s + n(a.valor), 0);
    const compraManual = doMes.filter((a) => a.tipo === "compra").reduce((s, a) => s + n(a.valor), 0);
    const notas = n(m?.saidas), cartao = n(m?.cartao), entradas = n(m?.entradas);
    const nfse = n(m?.nfse);
    // Resumo antigo sem tipos de documento: não presumir que as fontes são disjuntas.
    const notasTotais = m?.sobreposicaoIncerta ? Math.max(notas, nfse) : notas + nfse;
    const faturamento = Math.max(notasTotais, cartao) + receitaManual;
    const compras = entradas + compraManual;
    if (m || doMes.length) ultimo = i;
    fatAcum += faturamento; compAcum += compras;
    return {
      mes: i, ativo: i >= primeiroMes && noPeriodo(ref), consultado: !!m, notas, nfse, cartao, receitaManual, faturamento,
      consultadoAtf: m?.consultadoAtf ?? (!!m && m.origem !== "nfse"), consultadoNfse: m?.consultadoNfse ?? m?.origem === "nfse",
      sobreposicaoIncerta: !!m?.sobreposicaoIncerta,
      entradas, compraManual, compras, semMovimento: !!m?.sem_movimento && !receitaManual && !compraManual,
      acimaFaturamento: faturamento > LIMITE_MES, acimaCompras: compras > LIMITE_MES * FRACAO_COMPRAS,
      faturamentoAcum: fatAcum, comprasAcum: compAcum,
    };
  });

  const decorridos = Math.max(ultimo - primeiroMes + 1, 0);
  const temDados = ultimo >= 0;
  const medida = (total: number, limite: number, dados = temDados): Medida => {
    const projecao = decorridos ? (total / decorridos) * ativos : 0;
    return { total, limite, pct: limite ? total / limite : 0, projecao, esperado: (limite / ativos) * decorridos,
      nivel: nivelDe(total, limite, projecao, dados) };
  };
  const faturamento = medida(fatAcum, limiteFat);
  const compras = medida(compAcum, limiteCompras, lista.some((m) => m.consultadoAtf || m.compraManual !== 0));
  const nivel = NIVEIS[faturamento.nivel].peso >= NIVEIS[compras.nivel].peso ? faturamento.nivel : compras.nivel;
  const somar = (k: "notas" | "nfse" | "cartao" | "receitaManual" | "entradas" | "compraManual") => lista.reduce((s, m) => s + m[k], 0);
  return {
    ano, inicio, primeiroMes, ativos, ultimo, decorridos, meses: lista, faturamento, compras, nivel,
    notas: somar("notas"), nfse: somar("nfse"), cartao: somar("cartao"), receitaManual: somar("receitaManual"),
    conferirFontes: lista.some((m) => m.sobreposicaoIncerta),
    entradas: somar("entradas"), compraManual: somar("compraManual"),
    mesesAcima: lista.filter((m) => m.acimaFaturamento).length,
    simei: [...porMes.values()].some((m) => m.simei === true),
  };
}
export type AnoMei = ReturnType<typeof analisarAno>;

/** O que fazer, em uma frase, para cada sinal. */
export function explicacao(a: AnoMei): string {
  const f = a.faturamento, c = a.compras;
  if (f.nivel === "excedeu20") return "O faturamento passou mais de 20% do limite: o desenquadramento retroage a janeiro (ou ao início da atividade). Avalie a migração para o Simples Nacional.";
  if (f.nivel === "excedeu") return "O faturamento passou do limite em até 20%: desenquadra a partir de 1º de janeiro do ano seguinte e o excesso é tributado. Planeje a migração.";
  if (c.nivel === "excedeu20" || c.nivel === "excedeu") return "As compras passaram de 80% do limite de faturamento. Verifique o desenquadramento do SIMEI.";
  if (f.nivel === "atencao") return "O faturamento já usou 80% ou mais do limite do ano. Acompanhe os próximos meses de perto.";
  if (c.nivel === "atencao") return "As compras já usaram 80% ou mais do limite de compras.";
  if (f.nivel === "ritmo" || c.nivel === "ritmo") return "Mantida a média mensal, o limite será ultrapassado até dezembro.";
  if (a.nivel === "sem_dados") return "Ainda não há consulta concluída para este MEI no período selecionado.";
  if (c.nivel === "sem_dados") return "O faturamento consultado está dentro do limite. As compras ainda não têm consulta ou lançamento no período.";
  return "Faturamento e compras estão dentro do limite, num ritmo compatível com o ano.";
}

export const reais = (v: number, casas = 2) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
export const mil = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
export const pct = (v: number) => `${Math.round(v * 100)}%`;
