import { contexto } from "@/lib/sessao";
import { mesAnterior } from "@/lib/documentos";
import FormAgendamento from "../FormAgendamento";

export default async function Agendar() {
  const { supabase, admin } = await contexto();
  const organizacoes = admin
    ? (await supabase.from("organizacoes").select("id, nome").eq("ativo", true).order("nome")).data ?? []
    : undefined;
  return (
    <>
      <h1>Agendar uma competência</h1>
      <div className="passo-form">
        <section className="cartao">
          <h2 className="titulo-cartao">Antes de enviar</h2>
          <ol className="preparo">
            <li>Baixe a planilha modelo.</li>
            <li>Preencha uma empresa por linha: inscrição estadual, nome, login e senha do ATF.</li>
            <li>Apague o X dos serviços de que a empresa não precisa.</li>
          </ol>
          <a className="botao" href="/modelos/modelo_empresas_sefaz_pb.xlsx" download>Baixar a planilha modelo</a>
          <details className="duvidas">
            <summary>Dúvidas comuns</summary>
            <dl>
              <dt>Preciso mandar a senha toda vez?</dt>
              <dd>Não. Depois da primeira vez, a senha daquele login pode ficar em branco.</dd>
              <dt>Como deixo uma empresa de fora?</dt>
              <dd>Troque o X da coluna ATIVA por N.</dd>
              <dt>Quanto tempo demora?</dt>
              <dd>Os PDFs saem na hora. Os XMLs chegam pelo ATF em alguns minutos.</dd>
              <dt>E o Dossiê MEI?</dt>
              <dd>Só é feito para empresas optantes pelo SIMEI.</dd>
              <dt>E a planilha depois de enviar?</dt>
              <dd>Apague-a do computador: ela contém as senhas. No portal elas ficam cifradas.</dd>
            </dl>
          </details>
        </section>
        <div className="cartao">
          <FormAgendamento organizacoes={organizacoes} competencia={mesAnterior()} />
        </div>
      </div>
    </>
  );
}
