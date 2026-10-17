import { contexto } from "@/lib/sessao";
import { mesAnterior } from "@/lib/cnpj";
import FormAgendamento from "./FormAgendamento";

export default async function Agendar() {
  const { supabase, admin } = await contexto();
  const organizacoes = admin
    ? (await supabase.from("organizacoes").select("id, nome").eq("ativo", true).order("nome")).data ?? []
    : undefined;
  const { inicio, fim } = mesAnterior();
  return (
    <>
      <h1>Agendar download de XML</h1>
      <div className="cartao">
        <p>
          Preencha a planilha modelo, uma linha por empresa: <b>CNPJ</b>, <b>apelido</b> (vira o nome da pasta),{" "}
          <b>senha do ATF</b> e, se o login não for o próprio CNPJ, o <b>login do ATF</b>. Depois escolha o período e os
          tipos de XML. O robô entra no ATF da SEFAZ-PB de cada empresa e salva os XML organizados por empresa, mês e tipo.
        </p>
        <p>
          <a className="botao secundario pequeno" href="/modelos/modelo_empresas_xml.xlsx" download>Baixar planilha modelo</a>
        </p>
        <p className="suave">
          Empresa já cadastrada pode vir com a senha em branco: o robô usa a que está guardada. A planilha contém senhas;
          apague-a do computador depois de enviar.
        </p>
      </div>
      <div className="cartao">
        <FormAgendamento organizacoes={organizacoes} inicio={inicio} fim={fim} />
      </div>
    </>
  );
}
