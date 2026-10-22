import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { contexto } from "@/lib/sessao";
import { competenciaBR, dataHoraBR } from "@/lib/documentos";
import { EM_ANDAMENTO } from "@/lib/xml";

type Agendamento = {
  id: string; nome_arquivo: string; competencia: string;
  executar_em: string; total: number; criado_em: string; organizacoes?: { nome: string } | null;
};
type Contagem = { prontas: number; fila: number; problemas: number; xml: number };

const ROBO_ONLINE_SEGUNDOS = 120;

export default async function Agendamentos() {
  const { supabase, admin } = await contexto();
  const { data } = await supabase
    .from("xml_agendamentos")
    .select("id, nome_arquivo, competencia, executar_em, total, criado_em, organizacoes(nome)")
    .order("criado_em", { ascending: false })
    .limit(30);
  const agendamentos = (data ?? []) as unknown as Agendamento[];

  const contagem = new Map<string, Contagem>(agendamentos.map((a) => [a.id, { prontas: 0, fila: 0, problemas: 0, xml: 0 }]));
  if (agendamentos.length) {
    const { data: tarefas } = await supabase
      .from("xml_tarefas").select("agendamento_id, status, qtd_xml").in("agendamento_id", agendamentos.map((a) => a.id)).limit(10000);
    for (const t of tarefas ?? []) {
      const c = contagem.get(t.agendamento_id)!;
      c.xml += t.qtd_xml ?? 0;
      if (EM_ANDAMENTO.includes(t.status)) c.fila++;
      else if (t.status === "concluido" || t.status === "sem_notas") c.prontas++;
      else if (t.status !== "cancelado") c.problemas++;
    }
  }
  const emAndamento = [...contagem.values()].some((c) => c.fila > 0);

  const { data: robos } = await supabase.from("xml_robos").select("id, ultimo_sinal").order("ultimo_sinal", { ascending: false }).limit(5);
  const agora = Date.now();
  const online = (robos ?? []).filter((r) => agora - Date.parse(r.ultimo_sinal) < ROBO_ONLINE_SEGUNDOS * 1000);

  return (
    <>
      <h1>Agendamentos</h1>
      <AutoRefresh ativo={emAndamento} segundos={10} />
      <div className={`faixa ${online.length ? "ok" : "alerta"}`}>
        {admin
          ? (online.length
            ? `Robô ligado (${online.map((r) => r.id).join(", ")}).`
            : `Robô desligado${robos?.[0] ? `; último sinal em ${dataHoraBR(robos[0].ultimo_sinal)}` : ""}. Os agendamentos ficam na fila até ele ligar.`)
          : (online.length
            ? "O robô está trabalhando: os agendamentos andam sozinhos."
            : "O robô está pausado no momento. Seus agendamentos ficam na fila e começam assim que ele voltar.")}
      </div>
      <div className="cartao">
        {!agendamentos.length ? (
          <p className="suave">Nenhum agendamento ainda. <Link href="/painel/agendar">Agendar agora</Link>.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>
                  <th>Criado em</th>
                  {admin && <th>Organização</th>}
                  <th>Competência</th>
                  <th>Arquivo</th>
                  <th>Início</th>
                  <th>Andamento</th>
                  <th>Arquivos</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {agendamentos.map((a) => {
                  const c = contagem.get(a.id)!;
                  return (
                    <tr key={a.id}>
                      <td>{dataHoraBR(a.criado_em)}</td>
                      {admin && <td>{a.organizacoes?.nome}</td>}
                      <td>{competenciaBR(a.competencia)}</td>
                      <td className="suave">{a.nome_arquivo}</td>
                      <td>{dataHoraBR(a.executar_em)}</td>
                      <td>
                        {c.prontas}/{a.total} prontas
                        {c.fila > 0 && <span className="status st-fila" style={{ marginLeft: 6 }}>{c.fila} na fila</span>}
                        {c.problemas > 0 && <span className="status st-erro" style={{ marginLeft: 6 }}>{c.problemas} com problema</span>}
                      </td>
                      <td>{c.xml}</td>
                      <td><Link className="botao secundario pequeno" href={`/painel/agendamentos/${a.id}`}>Detalhes</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
