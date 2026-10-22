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
        <div className="cartao">
          <h2 style={{ marginTop: 0 }}>A planilha das empresas</h2>
          <p>
            Uma empresa por linha: <b>INSCRICAO ESTADUAL</b> (é por ela que o ATF pesquisa), <b>NOME FANTASIA</b>,{" "}
            <b>LOGIN</b> e <b>SENHA</b> do contador no ATF. Os serviços já vêm marcados com X; apague o X do que não
            quiser. Para deixar uma empresa de fora, troque o X de <b>ATIVA</b> por N.
          </p>
          <p className="suave">
            Notas, NFC-e e CT-e chegam por Minhas Mensagens e podem levar alguns minutos. Faturas, extrato, omissão,
            certidão e conferência de cartão saem na hora, em PDF. O Dossiê MEI só é feito para quem é optante do SIMEI.
          </p>
          <p className="suave">
            A senha só precisa vir uma vez por login: depois de cadastrada, pode ficar em branco. A planilha tem senhas;
            apague-a do computador depois de enviar.
          </p>
          <a className="botao secundario" href="/modelos/modelo_empresas_sefaz_pb.xlsx" download>Baixar a planilha modelo</a>
        </div>
        <div className="cartao">
          <FormAgendamento organizacoes={organizacoes} competencia={mesAnterior()} />
        </div>
      </div>
    </>
  );
}
