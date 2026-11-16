"use client";

import Tabela from "@/components/ui/Tabela";
import Paginacao from "@/components/ui/Paginacao";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import Icone from "@/components/Icones";
import BotaoRemover from "../empresas/BotaoRemover";
import { dataBR, dataHoraBR, formatarDocumento, iniciais } from "@/lib/documentos";
import { SITUACAO_MONITOR, reaisMonitor, type MonitorLinha } from "@/lib/monitor";
import { consultarAgora, removerMonitor } from "./actions";

export type LinhaTabela = MonitorLinha & {
  organizacao: string; comprasMes: number; notasMes: number;
  certificado: { validade: string | null; nome: string; classe: string; vencido: boolean } | null;
};

/** Empresas monitoradas, da última nota encontrada para trás, com filtro por nome ou CNPJ. */
export default function TabelaMonitor({ linhas, gerencia, admin }: { linhas: LinhaTabela[]; gerencia: boolean; admin: boolean }) {
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const termo = useDeferredValue(filtro).trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  const visiveis = linhas.filter((x) => !termo || x.nome.toLowerCase().includes(termo) || (digitos && x.cnpj.includes(digitos))
    || x.codigo.toLowerCase() === termo);
  const atual = Math.min(pagina, Math.max(1, Math.ceil(visiveis.length / 25)));
  return (
    <>
      <div className="cartao-topo">
        <input type="search" className="busca-monitor" placeholder="Filtrar por nome ou CNPJ" value={filtro}
          onChange={(e) => { setFiltro(e.target.value); setPagina(1); }} aria-label="Filtrar empresas monitoradas" />
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
            {visiveis.slice((atual - 1) * 25, atual * 25).map((x) => {
              const s = SITUACAO_MONITOR[x.status] ?? SITUACAO_MONITOR.fila;
              return (
                <tr key={x.id} className={x.ativo ? "" : "inativo"}>
                  {admin && <td>{x.organizacao}</td>}
                  <td><span className="compras-mes">{reaisMonitor(x.comprasMes)}</span>
                    {x.notasMes > 0 && <small className="suave"> {x.notasMes} nota{x.notasMes > 1 ? "s" : ""}</small>}</td>
                  <td className="doc">{formatarDocumento(x.cnpj)}</td>
                  <td className="nome-empresa">
                    <span className="com-avatar"><span className="avatar-q" aria-hidden="true">{iniciais(x.nome)}</span>
                      <span>{x.nome}{x.codigo && <small className="suave"> ID {x.codigo}</small>}</span></span>
                  </td>
                  <td>
                    {x.certificado
                      ? <span className={`status ${x.certificado.classe}`}>
                          {x.certificado.vencido ? "Vencido" : x.certificado.validade ? `Válido até ${dataBR(x.certificado.validade.slice(0, 10))}` : x.certificado.nome}
                        </span>
                      : <Link href="/painel/certificados" className="status st-erro">Falta o certificado</Link>}
                  </td>
                  <td>{x.ultima_nota_em ? dataHoraBR(x.ultima_nota_em) : <span className="suave">—</span>}</td>
                  <td>
                    <span className={`status ${s.classe}`}>{s.nome}</span>
                    {x.mensagem && <details className="tarefa-detalhe"><summary>Ver detalhe<span className="sr"> de {x.nome}</span></summary><p>{x.mensagem}</p></details>}
                  </td>
                  <td>{x.status === "processando" ? <span className="suave">agora</span> : dataHoraBR(x.proxima_consulta)}</td>
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
      <Paginacao total={visiveis.length} pagina={atual} aoMudar={setPagina} rotulo="Paginação do Monitor Fiscal" />
    </>
  );
}
