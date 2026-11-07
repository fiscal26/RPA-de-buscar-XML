"use client";

import Link from "next/link";
import { useState } from "react";
import Icone from "@/components/Icones";
import BotaoRemover from "../empresas/BotaoRemover";
import { dataBR, dataHoraBR, formatarDocumento } from "@/lib/documentos";
import { SITUACAO_MONITOR, reaisMonitor, type MonitorLinha } from "@/lib/monitor";
import { consultarAgora, removerMonitor } from "./actions";

export type LinhaTabela = MonitorLinha & {
  organizacao: string; comprasMes: number; notasMes: number;
  certificado: { validade: string | null; nome: string; classe: string; vencido: boolean } | null;
};

/** Empresas monitoradas, da última nota encontrada para trás, com filtro por nome ou CNPJ. */
export default function TabelaMonitor({ linhas, gerencia, admin }: { linhas: LinhaTabela[]; gerencia: boolean; admin: boolean }) {
  const [filtro, setFiltro] = useState("");
  const termo = filtro.trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  const visiveis = linhas.filter((x) => !termo || x.nome.toLowerCase().includes(termo) || (digitos && x.cnpj.includes(digitos))
    || x.codigo.toLowerCase() === termo);
  return (
    <>
      <div className="cartao-topo">
        <input type="search" className="busca-monitor" placeholder="Filtrar por nome ou CNPJ" value={filtro}
          onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar empresas monitoradas" />
        <span className="suave">{visiveis.length} de {linhas.length}</span>
      </div>
      <div className="tabela-rolagem">
        <table className="tabela-monitor">
          <thead>
            <tr>
              {admin && <th>Organização</th>}
              <th>Compras no mês</th><th>CNPJ</th><th>Razão social</th><th>Certificado</th><th>Última nota</th>
              <th>Situação</th><th>Próxima consulta</th><th><span className="sr">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((x) => {
              const s = SITUACAO_MONITOR[x.status] ?? SITUACAO_MONITOR.fila;
              return (
                <tr key={x.id} className={x.ativo ? "" : "inativo"}>
                  {admin && <td>{x.organizacao}</td>}
                  <td><span className="compras-mes">{reaisMonitor(x.comprasMes)}</span>
                    {x.notasMes > 0 && <small className="suave"> {x.notasMes} nota{x.notasMes > 1 ? "s" : ""}</small>}</td>
                  <td className="doc">{formatarDocumento(x.cnpj)}</td>
                  <td className="nome-empresa">{x.codigo && <span className="suave">{x.codigo} · </span>}{x.nome}</td>
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
                    {x.mensagem && <small className="mensagem-monitor suave" title={x.mensagem}>{x.mensagem}</small>}
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
      </div>
    </>
  );
}
