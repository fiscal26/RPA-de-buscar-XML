import { contexto } from "@/lib/sessao";
import { mesAnterior } from "@/lib/documentos";
import FormAgendamento from "./FormAgendamento";

export default async function Agendar() {
  const { supabase, admin } = await contexto();
  const organizacoes = admin
    ? (await supabase.from("organizacoes").select("id, nome").eq("ativo", true).order("nome")).data ?? []
    : undefined;
  return (
    <>
      <h1>Agendar download de XML</h1>
      <div className="cartao">
        <p>
          Preencha a planilha modelo, uma linha por empresa: <b>INSCRICAO ESTADUAL</b> (é por ela que o ATF pesquisa),{" "}
          <b>NOME FANTASIA</b>, <b>LOGIN</b> e <b>SENHA</b> do contador no ATF, e marque com <b>S</b> os XML desejados em{" "}
          <b>NF-e Saida</b>, <b>NF-e Entrada</b> e <b>NFC-e</b>. Empresas com <b>ATIVA</b> = N ficam de fora.
        </p>
        <p>
          <a className="botao secundario pequeno" href="/modelos/modelo_empresas_sefaz_pb.xlsx" download>Baixar planilha modelo</a>
        </p>
        <p className="suave">
          A senha só precisa vir uma vez por login: depois de cadastrada, pode ficar em branco. A planilha contém
          senhas; apague-a do computador depois de enviar. As colunas de CT-e, faturas e certidões são de outros
          serviços e não são usadas aqui.
        </p>
      </div>
      <div className="cartao">
        <FormAgendamento organizacoes={organizacoes} competencia={mesAnterior()} />
      </div>
    </>
  );
}
