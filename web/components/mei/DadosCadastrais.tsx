import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemDescoberta, DecisaoMei } from "@/lib/mei-acompanhamento";
import { dataBR, dataHoraBR } from "@/lib/documentos";

export default async function DadosCadastrais({
  supabase,
  org,
  cnpj,
  decisao,
}: {
  supabase: SupabaseClient;
  org: string;
  cnpj: string;
  decisao?: DecisaoMei;
}) {
  const { data } = await supabase
    .from("xml_mei_sincronizacao_itens")
    .select("dados,consultado_em,resultado,mensagem")
    .eq("org_id", org)
    .eq("cnpj", cnpj)
    .not("dados", "is", null)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const item = data as Pick<
    ItemDescoberta,
    "dados" | "consultado_em" | "resultado" | "mensagem"
  > | null;
  if (!item?.dados && !decisao) return null;
  return (
    <section className="cartao mei-gestao">
      <h2>Enquadramento e acompanhamento</h2>
      {decisao && (
        <p>
          Acompanhamento:{" "}
          <b>
            {
              { ativo: "Ativo", pausado: "Pausado", ignorado: "Ignorado" }[
                decisao.estado
              ]
            }
          </b>{" "}
          · origem:{" "}
          {{
            manual: "decisão do escritório",
            automatico: "consulta automática",
            lote: "inclusão em lote",
            legado: "cadastro anterior",
          }[decisao.origem] ?? decisao.origem}
          {decisao.motivo && ` · ${decisao.motivo}`}
        </p>
      )}
      {item?.dados && (
        <>
          <p>
            Abertura do CNPJ:{" "}
            <b>
              {item.dados.abertura
                ? dataBR(item.dados.abertura)
                : "não informada"}
            </b>{" "}
            · Início no SIMEI na base consultada:{" "}
            <b>
              {item.dados.inicioMei
                ? dataBR(item.dados.inicioMei)
                : "não informado"}
            </b>{" "}
            · MEI na base:{" "}
            <b>
              {item.dados.mei === true
                ? "Sim"
                : item.dados.mei === false
                  ? "Não"
                  : "não informado"}
            </b>
          </p>
          <p className="suave">
            Fonte: CNPJá · consulta{" "}
            {item.consultado_em ? dataHoraBR(item.consultado_em) : "sem data"}
            {item.dados.atualizadoEm &&
              ` · atualização da fonte ${dataHoraBR(item.dados.atualizadoEm)}`}
            . Dados públicos podem estar defasados; as datas confirmadas
            manualmente prevalecem.
          </p>
          {["revisar", "erro", "pendente"].includes(item.resultado) && (
            <p className="faixa alerta">
              Confira o cadastro: {item.mensagem} O histórico e as datas
              confirmadas foram preservados.
            </p>
          )}
        </>
      )}
    </section>
  );
}
