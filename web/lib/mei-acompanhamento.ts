import { dataCnpj, type DadosCnpj } from "./cnpja";

export const RESULTADOS_MEI: Record<string, string> = {
  pendente: "Aguardando consulta",
  processando: "Consultando",
  elegivel: "Pronta para incluir",
  incluido: "Incluída",
  acompanhado: "Já acompanhada",
  nao_mei: "Não optante na base",
  revisar: "Conferir cadastro",
  dispensado: "Pausa/exclusão respeitada",
  erro: "Consulta indisponível",
};
export type DecisaoMei = {
  org_id: string;
  cnpj: string;
  estado: "ativo" | "pausado" | "ignorado";
  versao: number;
  origem: string;
  motivo: string;
};
export type ItemDescoberta = {
  id: string;
  lote_id: string;
  org_id: string;
  cnpj: string;
  nome: string;
  resultado: string;
  mensagem: string;
  dados: DadosCnpj | null;
  consultado_em: string | null;
  criado_em: string;
  decisao_versao: number;
};
export function schemaMeiAusente(
  erro: { code?: string; message?: string } | null | undefined,
) {
  return (
    !!erro &&
    ["42P01", "PGRST205", "PGRST202", "42883"].includes(erro.code ?? "")
  );
}
export async function lerTodosMei<T>(consulta: {
  range: (
    de: number,
    ate: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { code?: string; message: string } | null;
  }>;
}) {
  const itens: T[] = [];
  for (let de = 0; ; de += 500) {
    const r = await consulta.range(de, de + 499);
    if (r.error) return { data: itens, error: r.error };
    itens.push(...(r.data ?? []));
    if (!r.data || r.data.length < 500) return { data: itens, error: null };
  }
}
export function classificarDadosMei(dados: DadosCnpj, hoje: string) {
  if (dados.mei === false)
    return {
      resultado: "nao_mei",
      mensagem:
        "A base consultada não informa enquadramento MEI atual. O histórico foi preservado.",
    };
  const abertura = dataCnpj(dados.abertura),
    inicio = dataCnpj(dados.inicioMei);
  if (
    dados.mei !== true ||
    !abertura ||
    !inicio ||
    abertura > hoje ||
    inicio > hoje ||
    inicio.slice(0, 7) < abertura.slice(0, 7)
  ) {
    return {
      resultado: "revisar",
      mensagem:
        "A informação cadastral ou as datas estão incompletas. Confira o enquadramento antes de incluir.",
    };
  }
  return {
    resultado: "elegivel",
    mensagem:
      "SIMEI e datas informados pela base consultada. Abertura e início no SIMEI foram preservados separadamente.",
  };
}
