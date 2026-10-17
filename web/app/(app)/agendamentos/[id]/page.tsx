import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { contexto } from "@/lib/sessao";
import { dataBR, dataHoraBR, formatarCnpj } from "@/lib/cnpj";
import { EM_ANDAMENTO, STATUS, nomeTipo } from "@/lib/xml";
import { cancelarAgendamento } from "../../actions";

type Tarefa = {
  id: string; cnpj: string; apelido: string; status: string; mensagem: string; qtd_xml: number;
  pasta: string; iniciado_em: string | null; concluido_em: string | null;
};

export default async function DetalheAgendamento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await contexto();
  const { data: ag } = await supabase
    .from("xml_agendamentos").select("id, nome_arquivo, data_inicio, data_fim, tipos, executar_em, criado_em").eq("id", id).maybeSingle();
  if (!ag) notFound();
  const { data } = await supabase
    .from("xml_tarefas").select("id, cnpj, apelido, status, mensagem, qtd_xml, pasta, iniciado_em, concluido_em")
    .eq("agendamento_id", id).order("apelido");
  const tarefas = (data ?? []) as Tarefa[];
  const pendentes = tarefas.filter((t) => t.status === "pendente").length;
  const emAndamento = tarefas.some((t) => EM_ANDAMENTO.includes(t.status));
  const cancelar = cancelarAgendamento.bind(null, id);

  return (
    <>
      <p><Link href="/agendamentos">← Agendamentos</Link></p>
      <h1>Agendamento de {dataHoraBR(ag.criado_em)}</h1>
      <AutoRefresh ativo={emAndamento} segundos={8} />
      <div className="cartao">
        <p>
          Período <b>{dataBR(ag.data_inicio)} a {dataBR(ag.data_fim)}</b> · {(ag.tipos as string[]).map(nomeTipo).join(", ")} ·
          início {dataHoraBR(ag.executar_em)}{ag.nome_arquivo && <> · {ag.nome_arquivo}</>}
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
            <tr><th>Empresa</th><th>CNPJ</th><th>Situação</th><th>XML</th><th>Detalhes</th><th>Pasta</th></tr>
          </thead>
          <tbody>
            {tarefas.map((t) => {
              const st = STATUS[t.status] ?? { nome: t.status, classe: "st-neutro" };
              return (
                <tr key={t.id}>
                  <td>{t.apelido}</td>
                  <td>{formatarCnpj(t.cnpj)}</td>
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
