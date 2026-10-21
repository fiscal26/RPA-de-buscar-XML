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
          A planilha modelo já vem com as opções marcadas com <b>X</b>. Preencha só os dados das empresas, uma por
          linha: <b>INSCRICAO ESTADUAL</b> (é por ela que o ATF pesquisa), <b>NOME FANTASIA</b>, <b>LOGIN</b> e{" "}
          <b>SENHA</b> do contador no ATF. Para não fazer algum serviço, apague o X da coluna dele (<b>NF-e Saida</b>,{" "}
          <b>NF-e Entrada</b>, <b>NFC-e</b>, <b>CT-e</b>, <b>Download Faturas</b>, <b>Extrato de Pagamentos</b>,{" "}
          <b>Omissão e Inadimplência</b>, <b>Certidão de Débitos</b> ou <b>Conferência Cartão de Credito</b>); para deixar uma empresa de fora, troque o X de <b>ATIVA</b> por N.
        </p>
        <p className="suave">
          O ATF não entrega o XML na hora: o robô faz as consultas e recolhe os arquivos em Minhas Mensagens, que podem
          levar alguns minutos para chegar. Faturas, extrato (do 1º ao último dia da competência), omissão, certidão e
          conferência de cartão saem na hora, em PDF.
        </p>
        <p>
          <a className="botao secundario pequeno" href="/modelos/modelo_empresas_sefaz_pb.xlsx" download>Baixar planilha modelo</a>
        </p>
        <p className="suave">
          A senha só precisa vir uma vez por login: depois de cadastrada, pode ficar em branco. A planilha contém
          senhas; apague-a do computador depois de enviar. A coluna Dossiê MEI ainda não é usada.
        </p>
      </div>
      <div className="cartao">
        <FormAgendamento organizacoes={organizacoes} competencia={mesAnterior()} />
      </div>
    </>
  );
}
