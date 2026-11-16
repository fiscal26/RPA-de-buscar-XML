import Link from "next/link";
import { contexto } from "@/lib/sessao";
import { lerTodosMei } from "@/lib/mei-acompanhamento";
import FormCadastroEmpresa from "./FormCadastroEmpresa";

export default async function NovaEmpresa({
  searchParams,
}: {
  searchParams: Promise<{ origem?: string; org?: string }>;
}) {
  const { supabase, admin, org } = await contexto();
  const sp = await searchParams;
  const [organizacoes, acessos] = await Promise.all([
    admin
      ? supabase
          .from("organizacoes")
          .select("id,nome")
          .eq("ativo", true)
          .order("nome")
      : Promise.resolve({ data: org ? [org] : [], error: null }),
    lerTodosMei<{ id: string; org_id: string; login: string }>(
      supabase
        .from("xml_acessos")
        .select("id,org_id,login")
        .order("org_id")
        .order("login"),
    ),
  ]);
  return (
    <>
      <p className="voltar">
        <Link href="/painel/empresas">Empresas</Link>
      </p>
      <div className="cabeca-pagina">
        <div>
          <h1>Cadastrar empresa</h1>
          <p className="suave">
            Cadastre uma empresa por vez e use os mesmos acessos e consultas da
            importação por planilha.
          </p>
        </div>
      </div>
      {organizacoes.error || acessos.error ? (
        <p className="faixa erro" role="alert">
          Não foi possível carregar os escritórios e acessos. Atualize a página
          para tentar novamente.
        </p>
      ) : (
        <section className="cartao cadastro-individual">
          <FormCadastroEmpresa
            organizacoes={organizacoes.data ?? []}
            acessos={acessos.data}
            orgInicial={admin ? sp.org : org?.id}
            origemInicial={sp.origem === "sefaz" ? "sefaz" : "nfse"}
          />
        </section>
      )}
    </>
  );
}
