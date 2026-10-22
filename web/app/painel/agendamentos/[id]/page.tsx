import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { contexto } from "@/lib/sessao";
import { competenciaBR, dataHoraBR, formatarIe } from "@/lib/documentos";
import { EM_ANDAMENTO, STATUS, nomeTipo } from "@/lib/xml";
import { cancelarAgendamento } from "../../actions";

type Tarefa = {
  id: string; ie: string; nome: string; codigo: string; tipos: string[]; status: string; mensagem: string; qtd_xml: number;
  pasta: string; iniciado_em: string | null; concluido_em: string | null;
};

export default async function DetalheAgendamento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await contexto();
  const { data: ag } = await supabase
    .from("xml_agendamentos").select("id, nome_arquivo, competencia, executar_em, criado_em").eq("id", id).maybeSingle();
  if (!ag) notFound();
  const { data } = await supabase
    .from("xml_tarefas").select("id, ie, nome, codigo, tipos, status, mensagem, qtd_xml, pasta, iniciado_em, concluido_em")
    .eq("agendamento_id", id).order("nome");
  const tarefas = (data ?? []) as Tarefa[];
  const pendentes = tarefas.filter((t) => t.status === "pendente").length;
  const emAndamento = tarefas.some((t) => EM_ANDAMENTO.includes(t.status));
  const cancelar = cancelarAgendamento.bind(null, id);

  return (
    <>
      <p><Link href="/painel/agendamentos">← Agendamentos</Link></p>
      <h1>Agendamento de {dataHoraBR(ag.criado_em)}</h1>
      <AutoRefresh ativo={emAndamento} segundos={8} />
      <div className="cartao">
        <p>
          Competência <b>{competenciaBR(ag.competencia)}</b> · início {dataHoraBR(ag.executar_em)}
          {ag.nome_arquivo && <> · {ag.nome_arquivo}</>}
        </p>
        {pendentes > 0 && (
          <form action={cancelar}>
            <button type="submit" className="perigo pequeno">Cancelar as {pendentes} empresa(s) que ainda não começaram</button>
          </form>
        )}
      </div>
      <div className="cartao tabela-rolagem">
        <table>
          <thead>
            <tr><th>ID</th><th>Empresa</th><th>Inscrição estadual</th><th>XML pedidos</th><th>Situação</th><th>Qtd.</th><th>Detalhes</th><th>Pasta</th></tr>
          </thead>
          <tbody>
            {tarefas.map((t) => {
              const st = STATUS[t.status] ?? { nome: t.status, classe: "st-neutro" };
              return (
                <tr key={t.id}>
                  <td>{t.codigo}</td>
                  <td>{t.nome}</td>
                  <td>{formatarIe(t.ie)}</td>
                  <td>{t.tipos.map(nomeTipo).join(", ")}</td>
                  <td><span className={`status ${st.classe}`}>{st.nome}</span></td>
                  <td>{t.qtd_xml || ""}</td>
                  <td className="suave">{t.mensagem}{t.concluido_em && <><br />{dataHoraBR(t.concluido_em)}</>}</td>
                  <td className="suave">{t.pasta}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
