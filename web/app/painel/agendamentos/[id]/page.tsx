import ReprocessarErros from "./ReprocessarErros";
import GradeTarefas from "./GradeTarefas";
import ProgressoTarefas from "@/components/ui/ProgressoTarefas";
import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { contexto } from "@/lib/sessao";
import { competenciaBR, dataHoraBR } from "@/lib/documentos";
import { ORDEM_TAREFAS, SITUACAO, SITUACOES_ABERTAS, expandirTipos, situacaoTarefa } from "@/lib/xml";
import { cancelarAgendamento } from "../../actions";

type Tarefa = {
  id: string; empresa_id: string | null; ie: string; nome: string; codigo: string; tipos: string[]; status: string; mensagem: string;
  detalhes: Record<string, { situacao?: string; mensagem?: string }>; concluido_em: string | null;
};

// ordem dos contadores no topo
const RESUMO = ["concluido", "sem_movimento", "erro", "aguardando", "andamento", "fila", "cancelado"];

export default async function DetalheAgendamento({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ filtro?: string }>;
}) {
  const { id } = await params;
  const pedido = (await searchParams).filtro;
  const filtro = pedido && SITUACAO[pedido] ? pedido : null;
  const { supabase } = await contexto();
  const { data: ag } = await supabase
    .from("xml_agendamentos").select("id, nome_arquivo, competencia, executar_em, criado_em, origem").eq("id", id).maybeSingle();
  if (!ag) notFound();
  const { data } = await supabase
    .from("xml_tarefas").select("id, empresa_id, ie, nome, codigo, tipos, status, mensagem, detalhes, concluido_em")
    .eq("agendamento_id", id).order("nome");
  const empresas = (data ?? []) as Tarefa[];
  const { data: repeticao, error: erroRepeticao } = ag.origem === "sefaz" ? await supabase.from("xml_agendamentos")
    .select("id, executar_em, reprocessamento_automatico").eq("reprocessamento_de", id).maybeSingle()
    : { data: null, error: null };
  const terminou = empresas.length > 0 && empresas.every((t) => !["pendente", "processando"].includes(t.status));
  const comErro = empresas.filter((t) => t.empresa_id && t.status !== "cancelado" && expandirTipos(t.tipos).some((tipo) => situacaoTarefa(t, tipo).chave === "erro")).length;

  // cada empresa x serviço é uma tarefa
  const colunas = ORDEM_TAREFAS.filter((tipo) => empresas.some((e) => expandirTipos(e.tipos).includes(tipo)));
  const linhas = empresas.map((e) => {
    const tipos = expandirTipos(e.tipos);
    return { e, celulas: colunas.map((tipo) => (tipos.includes(tipo) ? situacaoTarefa(e, tipo) : null)) };
  });
  // filtro pelos contadores: as empresas com essa situação sobem (as com mais tarefas nela primeiro)
  const naSituacao = (l: (typeof linhas)[number]) => l.celulas.filter((c) => c?.chave === filtro).length;
  if (filtro) linhas.sort((a, b) => naSituacao(b) - naSituacao(a));
  const todas = linhas.flatMap((l) => l.celulas.filter((c): c is { chave: string; mensagem: string } => c !== null));
  const conta = (chave: string) => todas.filter((c) => c.chave === chave).length;
  const abertas = todas.filter((c) => SITUACOES_ABERTAS.includes(c.chave)).length;
  const feitas = todas.length - abertas;
  const pendentes = empresas.filter((t) => t.status === "pendente").length;
  const cancelar = cancelarAgendamento.bind(null, id);

  return (
    <>
      <p className="voltar"><Link href="/painel/agendamentos">Agendamentos</Link></p>
      <div className="cabeca-pagina">
        <div>
          <h1>Competência {competenciaBR(ag.competencia)}{ag.origem === "nfse" && " · NFS-e"}</h1>
          <p className="suave">
            Agendado em {dataHoraBR(ag.criado_em)}, início {dataHoraBR(ag.executar_em)}{ag.nome_arquivo && `, ${ag.nome_arquivo}`}
          </p>
        </div>
        <div className="acoes">
        {repeticao ? <p className="aviso-reprocessamento" role="status">
          {repeticao.reprocessamento_automatico ? "Reprocessamento automático" : "Reprocessamento"}
          {` programado para ${dataHoraBR(repeticao.executar_em)} (Brasília). `}
          <Link href={`/painel/agendamentos/${repeticao.id}`}>Acompanhar</Link>
        </p> : !erroRepeticao && ag.origem === "sefaz" && terminou && comErro > 0
          ? <ReprocessarErros id={id} empresas={comErro} /> : null}
        <a className="botao secundario" href={`/painel/agendamentos/${id}/planilha`} download
          title="As mesmas empresas e serviços, com a senha em branco (o portal já tem a senha guardada)">
          Baixar a planilha
        </a>
        {pendentes > 0 && (
          <form action={cancelar}>
            <button type="submit" className="perigo">
              {pendentes === 1 ? "Cancelar a empresa que não começou" : `Cancelar as ${pendentes} empresas que não começaram`}
            </button>
          </form>
        )}
        </div>
      </div>
      <AutoRefresh ativo={abertas > 0} segundos={5} />

      <ProgressoTarefas feitas={feitas} total={todas.length} abertas={abertas} erros={conta("erro")}>
        <ul className="contadores">
          {RESUMO.filter((k) => conta(k)).map((k) => (
            <li key={k}>
              {/* clicar filtra; clicar de novo limpa o filtro */}
              <Link href={filtro === k ? `/painel/agendamentos/${id}` : `/painel/agendamentos/${id}?filtro=${k}`} scroll={false}
                className={`status ${SITUACAO[k].classe} contador ${filtro === k ? "ativo" : ""}`} aria-current={filtro === k ? "true" : undefined}
                title={filtro === k ? "Limpar o filtro" : `Mostrar primeiro as empresas com ${SITUACAO[k].nome.toLowerCase()}`}>
                {SITUACAO[k].nome}: {conta(k)}{filtro === k && <span aria-hidden="true"> ✕</span>}
              </Link>
            </li>
          ))}
        </ul>
      </ProgressoTarefas>

      <section className="cartao">
        <div className="cartao-topo">
          <h2 className="titulo-cartao">{empresas.length} empresa{empresas.length === 1 ? "" : "s"}</h2>
          {filtro && (
            <span className="suave">
              {(() => { const n = linhas.filter((l) => naSituacao(l) > 0).length; return `${n} ${n === 1 ? "empresa" : "empresas"} com ${SITUACAO[filtro].nome.toLowerCase()} no topo · `; })()}
              <Link href={`/painel/agendamentos/${id}`} scroll={false}>limpar filtro</Link>
            </span>
          )}
        </div>
        <GradeTarefas colunas={colunas} filtro={filtro} linhas={linhas.map(({ e, celulas }) => ({
          id: e.id, nome: e.nome, codigo: e.codigo, ie: e.ie,
          aviso: ["senha_invalida", "fora_do_ar", "certificado"].includes(e.status) ? e.mensagem : "",
          celulas,
        }))} />
      </section>
    </>
  );
}
