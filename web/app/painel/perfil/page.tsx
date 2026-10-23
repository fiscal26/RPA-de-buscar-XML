import { contexto } from "@/lib/sessao";
import { FormAlertas, FormNome, FormSenhaPropria } from "./Formularios";

const PAPEL: Record<string, string> = { admin: "Administrador", gestor: "Gestor", usuario: "Colaborador" };

export default async function MeuPerfil() {
  const { supabase, perfil, org } = await contexto();
  // coluna nova (schema.sql): sem ela, os alertas contam como ligados
  const { data: pref } = await supabase.from("perfis").select("alertas_mei").eq("id", perfil.id).maybeSingle();
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
        {!!perfil.org_id && (
          <section className="cartao">
            <h2 className="titulo-cartao">Alertas por e-mail</h2>
            <p className="suave">
              Avisos do Monitoramento MEI: quando um MEI entra no ritmo de passar do limite, chega a 80% ou passa do limite
              de faturamento ou de compras. Cada aviso sai uma vez por ano.
            </p>
            <FormAlertas ligado={pref?.alertas_mei !== false} />
          </section>
        )}
      </div>
    </>
  );
}
