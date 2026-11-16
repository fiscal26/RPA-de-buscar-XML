import Link from "next/link";
import { contexto } from "@/lib/sessao";
import {
  lerTodosMei,
  schemaMeiAusente,
  type DecisaoMei,
  type ItemDescoberta,
} from "@/lib/mei-acompanhamento";
import type { CadastroMei } from "@/lib/mei-carteira";
import FormCadastroMei from "../FormCadastroMei";
import GerenciarMeis from "./GerenciarMeis";

export default async function Gerenciar({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; cnpj?: string; lote?: string }>;
}) {
  const { supabase, admin, perfil } = await contexto();
  const sp = await searchParams;
  const { data: organizacoes } = await supabase
    .from("organizacoes")
    .select("id,nome")
    .eq("ativo", true)
    .order("nome");
  const orgs = (organizacoes ?? []) as { id: string; nome: string }[];
  const org = admin
    ? orgs.some((o) => o.id === sp.org)
      ? sp.org!
      : orgs[0]?.id
    : perfil.org_id;
  if (!org) return <p>Nenhum escritório disponível.</p>;
  const pode = admin || perfil.papel === "gestor";
  const [sefaz, nfse, cadastros, decisoes, lotes, worker] = await Promise.all([
    lerTodosMei<{ cnpj: string; nome: string }>(
      supabase
        .from("xml_empresas")
        .select("cnpj,nome")
        .eq("org_id", org)
        .order("id"),
    ),
    lerTodosMei<{ cnpj: string; nome: string }>(
      supabase
        .from("xml_nfse_empresas")
        .select("cnpj,nome")
        .eq("org_id", org)
        .order("id"),
    ),
    lerTodosMei<CadastroMei>(
      supabase
        .from("xml_mei_cadastros")
        .select("org_id,cnpj,nome,ativo,inicio_atividade,inicio_mei,fim_mei")
        .eq("org_id", org)
        .order("cnpj"),
    ),
    lerTodosMei<DecisaoMei>(
      supabase
        .from("xml_mei_acompanhamento")
        .select("org_id,cnpj,estado,origem,motivo,versao")
        .eq("org_id", org)
        .order("cnpj"),
    ),
    supabase
      .from("xml_mei_sincronizacoes")
      .select("id,origem,estado,criado_em")
      .eq("org_id", org)
      .order("criado_em", { ascending: false })
      .limit(30),
    supabase.from("xml_mei_worker").select("ultimo_sinal").maybeSingle(),
  ]);
  const ausente =
    schemaMeiAusente(decisoes.error) || schemaMeiAusente(lotes.error);
  const erro = [
    sefaz.error,
    nfse.error,
    cadastros.error,
    decisoes.error,
    lotes.error,
    worker.error,
  ].find((e) => e && !schemaMeiAusente(e));
  const empresas = [
    ...new Map(
      [...sefaz.data, ...nfse.data]
        .filter((e) => /^\d{14}$/.test(e.cnpj))
        .map((e) => [e.cnpj, e]),
    ).values(),
  ].sort((a, b) => a.nome.localeCompare(b.nome));
  const listaLotes = (lotes.data ?? []) as {
    id: string;
    origem: string;
    estado: string;
    criado_em: string;
  }[];
  const lote =
    listaLotes.find((l) => l.id === sp.lote) ??
    listaLotes.find((l) => l.origem === "manual") ??
    listaLotes[0];
  const itens = lote
    ? await lerTodosMei<ItemDescoberta>(
        supabase
          .from("xml_mei_sincronizacao_itens")
          .select(
            "id,lote_id,org_id,cnpj,nome,resultado,mensagem,dados,consultado_em,criado_em,decisao_versao",
          )
          .eq("org_id", org)
          .eq("lote_id", lote.id)
          .order("cnpj"),
      )
    : { data: [], error: null };
  return (
    <>
      <div className="cabeca-pagina">
        <div>
          <h1>Gerenciar acompanhamento MEI</h1>
          <p className="suave">
            Novos CNPJs são verificados automaticamente. Para a carteira
            existente, confira o lote antes de incluir.
          </p>
        </div>
        <Link className="botao secundario" href="/painel/mei">
          Ver monitoramento
        </Link>
      </div>
      {admin && (
        <form className="linha" action="/painel/mei/gerenciar">
          <label>
            Escritório{" "}
            <select name="org" defaultValue={org}>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome}
                </option>
              ))}
            </select>
          </label>
          <button className="secundario">Abrir escritório</button>
        </form>
      )}
      {ausente && (
        <p className="faixa alerta" role="status">
          {admin
            ? "Aplique a migração MEI de 16/11/2026 no Supabase para habilitar esta gestão."
            : "O administrador precisa atualizar o banco para habilitar esta gestão."}{" "}
          O monitoramento atual continua disponível.
        </p>
      )}
      {(erro || itens.error) && (
        <p className="faixa erro" role="alert">
          Não foi possível ler todos os dados. Atualize a página antes de
          alterar o acompanhamento.
        </p>
      )}
      {!ausente && !erro && !itens.error && (
        <GerenciarMeis
          key={`${org}:${lote?.id ?? "novo"}`}
          org={org}
          empresas={empresas}
          cadastros={cadastros.data}
          decisoes={decisoes.data}
          itens={itens.data}
          lotes={listaLotes}
          lote={lote?.id}
          pode={pode}
          workerAtivo={
            !!worker.data?.ultimo_sinal &&
            Date.now() - Date.parse(worker.data.ultimo_sinal) < 180000
          }
          competencia={new Date()
            .toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })
            .slice(0, 7)}
        />
      )}
      {pode && (
        <details className="empresas-painel" open={!!sp.cnpj}>
          <summary>Cadastro manual e correção de datas</summary>
          <div id="cadastro-mei" className="empresas-painel-corpo">
            <p className="suave">
              Confira as datas antes de salvar. Salvar com acompanhamento
              marcado é uma decisão explícita de inclusão ou reativação.
            </p>
            <FormCadastroMei
              empresas={empresas.map((e) => ({
                ...e,
                org,
                escritorio: "",
                sugestao: false,
              }))}
              cadastros={cadastros.data}
              empresaInicial={
                sp.cnpj && empresas.some((e) => e.cnpj === sp.cnpj)
                  ? `${org}|${sp.cnpj}`
                  : undefined
              }
            />
          </div>
        </details>
      )}
    </>
  );
}
