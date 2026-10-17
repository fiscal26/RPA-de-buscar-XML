import { contexto } from "@/lib/sessao";
import { dataHoraBR, formatarCnpj } from "@/lib/cnpj";
import { removerEmpresa } from "../actions";
import BotaoRemover from "./BotaoRemover";

type Empresa = { id: string; cnpj: string; apelido: string; login_atf: string; atualizado_em: string; organizacoes?: { nome: string } | null };

export default async function Empresas() {
  const { supabase, admin } = await contexto();
  // a senha cifrada nem é lida aqui (o banco só libera estas colunas para o usuário)
  const { data } = await supabase
    .from("xml_empresas").select("id, cnpj, apelido, login_atf, atualizado_em, organizacoes(nome)").order("apelido");
  const empresas = (data ?? []) as unknown as Empresa[];
  return (
    <>
      <h1>Empresas cadastradas</h1>
      <div className="cartao">
        <p className="suave">
          As empresas entram aqui pela planilha do agendamento. Para trocar a senha do ATF, envie a empresa de novo na
          planilha com a senha nova. As senhas ficam cifradas e não aparecem no portal.
        </p>
        {!empresas.length ? (
          <p className="suave">Nenhuma empresa cadastrada ainda.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>{admin && <th>Organização</th>}<th>Apelido</th><th>CNPJ</th><th>Login ATF</th><th>Senha atualizada em</th><th></th></tr>
              </thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.id}>
                    {admin && <td>{e.organizacoes?.nome}</td>}
                    <td>{e.apelido}</td>
                    <td>{formatarCnpj(e.cnpj)}</td>
                    <td>{e.login_atf || <span className="suave">o próprio CNPJ</span>}</td>
                    <td>{dataHoraBR(e.atualizado_em)}</td>
                    <td>
                      <form action={removerEmpresa}>
                        <input type="hidden" name="id" value={e.id} />
                        <BotaoRemover apelido={e.apelido} />
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
