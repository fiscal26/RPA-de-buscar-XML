"use client";

import Tabela from "@/components/ui/Tabela";
import Paginacao from "@/components/ui/Paginacao";

import Link from "next/link";
import { useDeferredValue, useState, type ReactNode } from "react";
import Icone from "@/components/Icones";
import BotaoRemover from "../empresas/BotaoRemover";
import { dataBR, dataHoraBR, formatarDocumento } from "@/lib/documentos";
import { SITUACAO_MONITOR, reaisMonitor, somarNotasMonitor, type MonitorLinha, type ResumoNotasMonitor } from "@/lib/monitor";
import { consultarAgora, removerMonitor } from "./actions";

export type LinhaTabela = MonitorLinha & ResumoNotasMonitor & {
  organizacao: string;
  certificado: { validade: string | null; nome: string; classe: string; vencido: boolean } | null;
};

const numero = (n: number) => n.toLocaleString("pt-BR");

/** Empresas monitoradas com totais de notas e compras para o filtro atual. */
export default function TabelaMonitor({ linhas, gerencia, admin, resumoGeral, clientesMonitorados, vazio }: {
  linhas: LinhaTabela[]; gerencia: boolean; admin: boolean; resumoGeral: ResumoNotasMonitor; clientesMonitorados: number; vazio: ReactNode;
}) {
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const termo = useDeferredValue(filtro).trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  const visiveis = linhas.filter((x) => !termo || x.nome.toLowerCase().includes(termo) || (digitos && x.cnpj.includes(digitos))
    || x.codigo.toLowerCase() === termo);
  const atual = Math.min(pagina, Math.max(1, Math.ceil(visiveis.length / 25)));
  const resumo = termo ? somarNotasMonitor(visiveis) : resumoGeral;
  return (
    <>
      <dl className="painel-numeros monitor-numeros">
        <div className="numero-cartao">
          <dt className="nome">Clientes monitorados</dt>
          <dd className="valor">{numero(clientesMonitorados)}</dd>
        </div>
        <div className="numero-cartao">
          <dt className="nome">Notas encontradas</dt>
          <dd className="valor">{numero(resumo.notasEncontradas)}</dd>
          <dd className="suave">desde o início do monitoramento</dd>
        </div>
        <div className="numero-cartao">
          <dt className="nome">Notas no mês</dt>
          <dd className="valor">{numero(resumo.notasMes)}</dd>
        </div>
        <div className="numero-cartao">
          <dt className="nome">Compras no mês</dt>
          <dd className="valor valor-moeda">{reaisMonitor(resumo.comprasMes)}</dd>
        </div>
      </dl>
      <section className="monitor-listagem" aria-label="Empresas monitoradas">
        {linhas.length ? (
          <ListaMonitor linhas={linhas} visiveis={visiveis} filtro={filtro} pagina={atual} gerencia={gerencia} admin={admin}
            aoFiltrar={(valor) => { setFiltro(valor); setPagina(1); }} aoPaginar={setPagina} />
        ) : vazio}
      </section>
    </>
  );
}

function ListaMonitor({ linhas, visiveis, filtro, pagina, gerencia, admin, aoFiltrar, aoPaginar }: {
  linhas: LinhaTabela[]; visiveis: LinhaTabela[]; filtro: string; pagina: number; gerencia: boolean; admin: boolean;
  aoFiltrar: (valor: string) => void; aoPaginar: (pagina: number) => void;
}) {
  return (
    <>
      <div className="cartao-topo">
        <input type="search" className="busca-monitor" placeholder="Filtrar por nome ou CNPJ" value={filtro}
          onChange={(e) => aoFiltrar(e.target.value)} aria-label="Filtrar empresas monitoradas" />
        <span className="suave">{visiveis.length} de {linhas.length}</span>
      </div>
      <Tabela rotulo="Empresas do Monitor Fiscal">
        <table className="tabela-monitor">
          <caption className="sr">Empresas do Monitor Fiscal</caption>
          <thead>
            <tr>
              {admin && <th scope="col">Organização</th>}
              <th scope="col">Compras no mês</th><th scope="col">CNPJ</th><th scope="col">Razão social</th><th scope="col">Certificado</th><th scope="col">Última nota</th>
              <th scope="col">Situação</th><th scope="col">Próxima consulta</th><th scope="col"><span className="sr">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {visiveis.slice((pagina - 1) * 25, pagina * 25).map((x) => {
              const s = SITUACAO_MONITOR[x.status] ?? SITUACAO_MONITOR.fila;
              return (
                <tr key={x.id} className={x.ativo ? "" : "inativo"}>
                  {admin && <td className="monitor-org">{x.organizacao}</td>}
                  <td><span className="compras-mes">{reaisMonitor(x.comprasMes)}</span>
                    {x.notasMes > 0 && <small className="suave"> {x.notasMes} nota{x.notasMes > 1 ? "s" : ""}</small>}</td>
                  <td className="doc">{formatarDocumento(x.cnpj)}</td>
                  <td className="nome-empresa">
                    <b>{x.nome}</b>{x.codigo && <small className="suave"> ID {x.codigo}</small>}
                  </td>
                  <td>
                    {x.certificado
                      ? <span className={`status ${x.certificado.classe}`}>
                          {x.certificado.vencido ? "Vencido" : x.certificado.validade ? `Válido até ${dataBR(x.certificado.validade.slice(0, 10))}` : x.certificado.nome}
                        </span>
                      : <Link href="/painel/certificados" className="status st-erro">Falta o certificado</Link>}
                  </td>
                  <td className="monitor-data">{x.ultima_nota_em ? <time dateTime={x.ultima_nota_em}>{dataHoraBR(x.ultima_nota_em)}</time> : <span className="suave">—</span>}</td>
                  <td>
                    <span className={`status ${s.classe}`}>{s.nome}</span>
                    {x.mensagem && <details className="tarefa-detalhe"><summary>Ver detalhe<span className="sr"> de {x.nome}</span></summary><p>{x.mensagem}</p></details>}
                  </td>
                  <td className="monitor-data">{x.status === "processando" ? <span className="suave">agora</span> : dataHoraBR(x.proxima_consulta)}</td>
                  <td>
                    <span className="acoes-icone">
                      <form action={consultarAgora}>
                        <input type="hidden" name="id" value={x.id} />
                        <button type="submit" className="secundario botao-icone" aria-label={`Consultar agora ${x.nome}`}
                          data-dica="Consultar agora" disabled={x.status === "processando"}>
                          <Icone nome="atualizar" tamanho={18} />
                        </button>
                      </form>
                      <Link href={`/painel/monitor/${x.id}`} className="botao secundario botao-icone" aria-label={`Notas de ${x.nome}`}
                        data-dica="Histórico">
                        <Icone nome="info" tamanho={18} />
                      </Link>
                      {gerencia && (
                        <form action={removerMonitor}>
                          <input type="hidden" name="id" value={x.id} />
                          <BotaoRemover apelido={x.nome} pergunta={`Tirar ${x.nome} do Monitor Fiscal? As notas já encontradas continuam no histórico.`} />
                        </form>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Tabela>
      {!visiveis.length && <p className="listagem-vazia" role="status">Nenhuma empresa encontrada. Tente outro nome ou CNPJ.</p>}
      <Paginacao total={visiveis.length} pagina={pagina} aoMudar={aoPaginar} rotulo="Paginação do Monitor Fiscal" />
    </>
  );
}
