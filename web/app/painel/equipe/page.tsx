import { redirect } from "next/navigation";
import { contexto } from "@/lib/sessao";
import { dataHoraBR, formatarDocumento } from "@/lib/documentos";
import { alternarAcesso, alternarEscritorio } from "./actions";
import { FormEscritorio, FormPessoa, FormSenha } from "./Formularios";

type Pessoa = { id: string; org_id: string | null; nome: string; email: string; papel: string; ativo: boolean; criado_em: string };
type Org = { id: string; nome: string; documento: string; ativo: boolean };

const PAPEL: Record<string, string> = { admin: "Administrador", gestor: "Gestor", usuario: "Colaborador" };

export default async function Equipe() {
  const { supabase, perfil, org, admin } = await contexto();
  if (!admin && perfil.papel !== "gestor") redirect("/painel");

  const [{ data: p }, { data: o }] = await Promise.all([
    supabase.from("perfis").select("id, org_id, nome, email, papel, ativo, criado_em").order("nome"),
    admin ? supabase.from("organizacoes").select("id, nome, documento, ativo").order("nome") : Promise.resolve({ data: [] }),
  ]);
  const pessoas = (p ?? []) as Pessoa[];
  const escritorios = (o ?? []) as Org[];
  const grupos = admin
    ? escritorios.map((e) => ({ org: e, pessoas: pessoas.filter((x) => x.org_id === e.id) }))
    : [{ org: org ? { ...org, documento: "" } : null, pessoas: pessoas.filter((x) => x.org_id === perfil.org_id) }];

  return (
    <>
      <div className="cabeca-pagina">
        <div>
          <h1>Equipe</h1>
          <p className="suave">
            {admin
              ? "Crie os escritórios clientes com o gestor de cada um. O gestor cadastra os próprios colaboradores."
              : "Cadastre quem do escritório usa o portal. Cada pessoa entra com o próprio e-mail."}
          </p>
        </div>
      </div>

      <div className={admin ? "duas-colunas" : ""}>
        {admin && (
          <section className="cartao">
            <h2 className="titulo-cartao">Novo escritório</h2>
            <FormEscritorio />
          </section>
        )}
        <section className="cartao">
          <h2 className="titulo-cartao">{admin ? "Nova pessoa num escritório" : "Novo colaborador"}</h2>
          <FormPessoa organizacoes={admin ? escritorios.filter((e) => e.ativo) : undefined} />
          <p className="suave">Envie o e-mail e a senha provisória para a pessoa; ela entra em {"/login"}.</p>
        </section>
      </div>

      {grupos.map(({ org: e, pessoas: lista }) => (
        <section key={e?.id ?? "sem"} className="cartao">
          <div className="cabeca-cartao">
            <div>
              <h2 className="titulo-cartao">{e?.nome ?? "Escritório"}</h2>
              {admin && e && (
                <p className="suave">
                  {e.documento ? `CNPJ ${formatarDocumento(e.documento)}. ` : ""}
                  {e.ativo ? "Acesso liberado." : "Acesso suspenso: ninguém deste escritório consegue entrar."}
                </p>
              )}
            </div>
            {admin && e && (
              <form action={alternarEscritorio}>
                <input type="hidden" name="id" value={e.id} />
                <button type="submit" className={e.ativo ? "perigo pequeno" : "secundario pequeno"}>
                  {e.ativo ? "Suspender escritório" : "Liberar escritório"}
                </button>
              </form>
            )}
          </div>
          {!lista.length ? (
            <p className="suave">Ninguém cadastrado ainda.</p>
          ) : (
            <div className="tabela-rolagem">
              <table>
                <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>Desde</th><th></th></tr></thead>
                <tbody>
                  {lista.map((x) => {
                    const podeMexer = x.id !== perfil.id && (admin || x.papel === "usuario");
                    return (
                      <tr key={x.id}>
                        <td>{x.nome || "—"}{x.id === perfil.id && <span className="suave"> (você)</span>}</td>
                        <td>{x.email}</td>
                        <td>{PAPEL[x.papel] ?? x.papel}</td>
                        <td><span className={`status ${x.ativo ? "st-ok" : "st-neutro"}`}>{x.ativo ? "Ativo" : "Desativado"}</span></td>
                        <td>{dataHoraBR(x.criado_em).slice(0, 10)}</td>
                        <td className="acoes-linha">
                          {podeMexer && (
                            <>
                              <form action={alternarAcesso}>
                                <input type="hidden" name="id" value={x.id} />
                                <button type="submit" className={x.ativo ? "perigo pequeno" : "secundario pequeno"}>
                                  {x.ativo ? "Desativar" : "Reativar"}
                                </button>
                              </form>
                              <details className="trocar-senha">
                                <summary>Senha</summary>
                                <FormSenha id={x.id} />
                              </details>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
