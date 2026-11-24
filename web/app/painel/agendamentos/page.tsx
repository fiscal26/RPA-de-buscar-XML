import Tabela from "@/components/ui/Tabela";
import Icone from "@/components/Icones";
import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { contexto } from "@/lib/sessao";
import { competenciaBR, dataHoraBR } from "@/lib/documentos";
import { EM_ANDAMENTO, ROBO_ONLINE_SEGUNDOS } from "@/lib/xml";

type Agendamento = {
  id: string; nome_arquivo: string; competencia: string; origem: string;
  executar_em: string; total: number; criado_em: string; organizacoes?: { nome: string } | null;
};
type Contagem = { prontas: number; fila: number; problemas: number; xml: number };

export default async function Agendamentos() {
  const { supabase, admin } = await contexto();
  const { data } = await supabase
    .from("xml_agendamentos")
    .select("id, nome_arquivo, competencia, origem, executar_em, total, criado_em, organizacoes(nome)")
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

  const { data: robos } = !admin ? { data: [] } : await supabase.from("xml_robos").select("id, ultimo_sinal").order("ultimo_sinal", { ascending: false }).limit(5);
  const agora = Date.now();
  const online = (robos ?? []).filter((r) => agora - Date.parse(r.ultimo_sinal) < ROBO_ONLINE_SEGUNDOS * 1000);

  return (
    <>
      <h1>Agendamentos</h1>
      <AutoRefresh ativo={emAndamento} segundos={10} />
      {admin && (  // o estado do robô é da operação: o cliente não precisa ver
        <div className={`faixa ${online.length ? "ok" : "alerta"}`}>
          {online.length
            ? `Robô ligado (${online.map((r) => r.id).join(", ")}).`
            : `Robô desligado${robos?.[0] ? `; último sinal em ${dataHoraBR(robos[0].ultimo_sinal)}` : ""}. Os agendamentos ficam na fila até ele ligar.`}
        </div>
      )}
      <div className="cartao">
        {!agendamentos.length ? (
          <p className="suave">Nenhum agendamento ainda. <Link href="/painel/agendar">Agendar agora</Link>.</p>
        ) : (
          <Tabela rotulo="Lista de agendamentos">
            <table>
              <caption className="sr">Lista de agendamentos</caption>
              <thead>
                <tr>
                  <th scope="col">Criado em</th>
                  {admin && <th scope="col">Organização</th>}
                  <th scope="col">Competência</th>
                  <th scope="col">Origem</th>
                  <th scope="col">Arquivo</th>
                  <th scope="col">Início</th>
                  <th scope="col">Andamento</th>
                  <th scope="col">Arquivos</th>
                  <th scope="col"><span className="sr">Ações</span></th>
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
                      <td title={a.origem === "nfse" ? "Portal Nacional da NFS-e" : "SEFAZ do estado"}>{a.origem === "nfse" ? "NFS-e" : "SEFAZ"}</td>
                      <td className="suave">{a.nome_arquivo}</td>
                      <td>{dataHoraBR(a.executar_em)}</td>
                      <td>
                        {c.prontas}/{a.total} prontas
                        {c.fila > 0 && <span className="status st-fila" style={{ marginLeft: 6 }}>{c.fila} na fila</span>}
                        {c.problemas > 0 && <span className="status st-erro" style={{ marginLeft: 6 }}>{c.problemas} com problema</span>}
                      </td>
                      <td>{c.xml}</td>
                      <td>
                        <Link className="botao-icone discreto" href={`/painel/agendamentos/${a.id}`} data-dica="Detalhes"
                          aria-label={`Detalhes do agendamento de ${competenciaBR(a.competencia)}`}>
                          <Icone nome="info" tamanho={18} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Tabela>
        )}
      </div>
    </>
  );
}
