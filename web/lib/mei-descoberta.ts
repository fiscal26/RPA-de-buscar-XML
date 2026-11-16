import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarDadosCnpj, type DadosCnpj } from "./cnpja";
import { cnpjValido } from "./documentos";
import { classificarDadosMei } from "./mei-acompanhamento";
export { schemaMeiAusente } from "./mei-acompanhamento";

export async function processarVerificacaoMei(
  db: SupabaseClient,
  requisitar: typeof fetch = fetch,
) {
  const { data: item, error } = await db.rpc("xml_mei_pegar_verificacao");
  if (error)
    throw new Error(
      "A fila cadastral não está disponível. Confira a atualização do banco.",
    );
  if (!item) {
    const revisao = await db.rpc("xml_mei_revisar_ativos");
    if (revisao.error)
      throw new Error("Não foi possível preparar a revisão cadastral.");
    return { processado: false };
  }
  let dados: DadosCnpj | null = null,
    consultado: string | null = null;
  let resultado = "revisar",
    mensagem = "CNPJ inválido; confira o cadastro da empresa.",
    espera = 0;
  if (cnpjValido(item.cnpj)) {
    const r = await buscarDadosCnpj(
      item.cnpj,
      false,
      {
        reservar: async (cnpj, forcar) => {
          const r = await db.rpc("xml_cnpja_reservar", {
            p_cnpj: cnpj,
            p_forcar: forcar,
          });
          if (r.error) throw r.error;
          return r.data;
        },
        finalizar: async (cnpj, token, dados, bloqueio) => {
          const r = await db.rpc("xml_cnpja_finalizar", {
            p_cnpj: cnpj,
            p_token: token,
            p_dados: dados,
            p_bloqueio: bloqueio,
          });
          if (r.error) throw r.error;
          return r.data === true;
        },
      },
      requisitar,
    );
    dados = r.dados ?? null;
    consultado = r.consultadoEm ?? null;
    espera = r.aguardar ?? 0;
    if (r.dados && !r.aviso)
      ({ resultado, mensagem } = classificarDadosMei(
        r.dados,
        new Date().toLocaleDateString("en-CA", {
          timeZone: "America/Sao_Paulo",
        }),
      ));
    else {
      resultado = r.aguardar && !r.dados ? "aguardar" : "erro";
      mensagem =
        r.aviso ||
        r.erro ||
        "Não foi possível confirmar os dados. A consulta será retomada.";
    }
  }
  const r = await db.rpc("xml_mei_finalizar_verificacao", {
    p_item: item.id,
    p_token: item.token,
    p_resultado: resultado,
    p_dados: dados,
    p_consultado_em: consultado,
    p_mensagem: mensagem,
    p_espera: espera,
  });
  if (r.error)
    throw new Error(
      "Não foi possível concluir a verificação cadastral; a reserva será retomada.",
    );
  return { processado: true, resultado: r.data as string };
}
