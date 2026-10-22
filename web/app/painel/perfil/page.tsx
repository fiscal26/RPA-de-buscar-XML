import { contexto } from "@/lib/sessao";
import { FormNome, FormSenhaPropria } from "./Formularios";

const PAPEL: Record<string, string> = { admin: "Administrador", gestor: "Gestor", usuario: "Colaborador" };

export default async function MeuPerfil() {
  const { perfil, org } = await contexto();
  return (
    <>
      <div className="cabeca-pagina">
        <div>
          <h1>Meu perfil</h1>
          <p className="suave">{perfil.email}, {PAPEL[perfil.papel].toLowerCase()}{org ? ` em ${org.nome}` : ""}</p>
        </div>
      </div>
      <div className="duas-colunas">
        <section className="cartao">
          <h2 className="titulo-cartao">Seus dados</h2>
          <p className="suave">O e-mail de acesso só é trocado pelo gestor ou pelo administrador.</p>
          <FormNome nome={perfil.nome} />
        </section>
        <section className="cartao">
          <h2 className="titulo-cartao">Senha</h2>
          <p className="suave">Pelo menos 8 caracteres.</p>
          <FormSenhaPropria />
        </section>
      </div>
    </>
  );
}
