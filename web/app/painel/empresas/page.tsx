import { contexto } from "@/lib/sessao";
import { dataHoraBR, formatarDocumento, formatarIe } from "@/lib/documentos";
import { nomeTipo } from "@/lib/xml";
import { removerEmpresa } from "../actions";
import BotaoRemover from "./BotaoRemover";
import Renomear from "./Renomear";

type Empresa = {
  id: string; ie: string; cnpj: string; codigo: string; nome: string; nome_fixo?: boolean; tipos: string[]; atualizado_em: string;
  xml_acessos?: { login: string } | null; organizacoes?: { nome: string } | null;
};
type Acesso = { id: string; login: string; atualizado_em: string };

export default async function Empresas() {
  const { supabase, admin } = await contexto();
  // a senha cifrada nem é lida aqui (o banco só libera o login e as datas para o usuário)
  const [{ data: e }, { data: a }] = await Promise.all([
    supabase.from("xml_empresas")
      .select("*, xml_acessos(login), organizacoes(nome)").order("nome"),
    supabase.from("xml_acessos").select("id, login, atualizado_em").order("login"),
  ]);
  const empresas = (e ?? []) as unknown as Empresa[];
  const acessos = (a ?? []) as Acesso[];
  return (
    <>
      <h1>Empresas cadastradas</h1>
      <div className="cartao">
        <p className="suave">
          As empresas e os logins entram aqui pela planilha do agendamento. Para trocar a senha de um login do ATF, envie
          a planilha com a senha nova nesse login: vale para todas as empresas dele. As senhas ficam cifradas e não
          aparecem no portal. Os nomes são corrigidos ao entrar (por exemplo, “lidi@ne silv4” vira “Lidiane Silva”);
          o nome renomeado aqui não muda mais com a planilha.
        </p>
        {!!acessos.length && (
          <p>
            <b>Logins do ATF:</b>{" "}
            {acessos.map((x) => `${x.login} (senha de ${dataHoraBR(x.atualizado_em)})`).join(" · ")}
          </p>
        )}
        {!empresas.length ? (
          <p className="suave">Nenhuma empresa cadastrada ainda.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>
                  {admin && <th>Organização</th>}
                  <th>ID</th><th>Nome fantasia</th><th>Inscrição estadual</th><th>CNPJ</th><th>Login ATF</th><th>XML</th><th></th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((x) => (
                  <tr key={x.id}>
                    {admin && <td>{x.organizacoes?.nome}</td>}
                    <td>{x.codigo}</td>
                    <td><Renomear id={x.id} nome={x.nome} fixo={!!x.nome_fixo} /></td>
                    <td>{formatarIe(x.ie)}</td>
                    <td>{formatarDocumento(x.cnpj)}</td>
                    <td>{x.xml_acessos?.login ?? <span className="suave">removido</span>}</td>
                    <td>{x.tipos.map(nomeTipo).join(", ")}</td>
                    <td>
                      <form action={removerEmpresa}>
                        <input type="hidden" name="id" value={x.id} />
                        <BotaoRemover apelido={x.nome} />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
