import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { contexto } from "@/lib/sessao";
import { competenciaBR, dataHoraBR, formatarDocumento, formatarIe } from "@/lib/documentos";
import { ORDEM_TAREFAS, SITUACAO, SITUACOES_ABERTAS, expandirTipos, nomeTipo, situacaoTarefa } from "@/lib/xml";
import { cancelarAgendamento } from "../../actions";

type Tarefa = {
  id: string; ie: string; nome: string; codigo: string; tipos: string[]; status: string; mensagem: string;
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
    .from("xml_tarefas").select("id, ie, nome, codigo, tipos, status, mensagem, detalhes, concluido_em")
    .eq("agendamento_id", id).order("nome");
  const empresas = (data ?? []) as Tarefa[];

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
  const pct = todas.length ? Math.round((feitas / todas.length) * 100) : 0;
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
        {pendentes > 0 && (
          <form action={cancelar}>
            <button type="submit" className="perigo">
              {pendentes === 1 ? "Cancelar a empresa que não começou" : `Cancelar as ${pendentes} empresas que não começaram`}
            </button>
          </form>
        )}
      </div>
      <AutoRefresh ativo={abertas > 0} segundos={5} />

      <section className="cartao progresso">
        <div className="progresso-topo">
          <h2 className="titulo-cartao">Progresso</h2>
          <span className="progresso-pct">{pct}%</span>
        </div>
        <div className="progresso-trilho" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
          aria-label={`${feitas} de ${todas.length} tarefas processadas`}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="progresso-rodape">
          <span>{feitas} de {todas.length} tarefas processadas</span>
          <span>{abertas ? `${abertas} em aberto` : "Tudo processado"}</span>
        </div>
        <ul className="contadores">
          {RESUMO.filter((k) => conta(k)).map((k) => (
            <li key={k}>
              {/* clicar filtra; clicar de novo limpa o filtro */}
              <Link href={filtro === k ? `/painel/agendamentos/${id}` : `/painel/agendamentos/${id}?filtro=${k}`} scroll={false}
                className={`status ${SITUACAO[k].classe} contador ${filtro === k ? "ativo" : ""}`} aria-pressed={filtro === k}
                title={filtro === k ? "Limpar o filtro" : `Mostrar primeiro as empresas com ${SITUACAO[k].nome.toLowerCase()}`}>
                {SITUACAO[k].nome}: {conta(k)}{filtro === k && <span aria-hidden="true"> ✕</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>

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
        <div className="tabela-rolagem grade-tarefas">
          <table>
            <thead>
              <tr><th>Empresa</th>{colunas.map((c) => <th key={c}>{nomeTipo(c)}</th>)}</tr>
            </thead>
            <tbody>
              {linhas.map(({ e, celulas }) => (
                <tr key={e.id} className={filtro ? (celulas.some((c) => c?.chave === filtro) ? "linha-filtrada" : "linha-apagada") : undefined}>
                  <td className="grade-empresa">
                    <b>{e.nome}</b>
                    <span>{e.codigo && `${e.codigo}, `}{e.ie.length === 14 ? `CNPJ ${formatarDocumento(e.ie)}` : `IE ${formatarIe(e.ie)}`}</span>
                    {e.mensagem && ["senha_invalida", "fora_do_ar", "certificado"].includes(e.status) && <span className="grade-aviso">{e.mensagem}</span>}
                  </td>
                  {celulas.map((c, i) => (
                    <td key={colunas[i]}>
                      {c && (
                        <span className={`celula-tarefa status ${SITUACAO[c.chave]?.classe ?? "st-neutro"}${filtro === c.chave ? " destaque" : ""}`} title={c.mensagem || undefined}>
                          {SITUACAO[c.chave]?.nome ?? c.chave}
                        </span>
                      )}
                      {c?.mensagem && c.chave === "erro" && <span className="celula-motivo">{c.mensagem}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="suave">Passe o mouse sobre uma tarefa para ver o detalhe.</p>
      </section>
    </>
  );
}
