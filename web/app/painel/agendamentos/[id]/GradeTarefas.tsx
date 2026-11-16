"use client";

import { useDeferredValue, useState } from "react";
import Tabela from "@/components/ui/Tabela";
import Paginacao from "@/components/ui/Paginacao";
import { formatarDocumento, formatarIe } from "@/lib/documentos";
import { nomeTipo, SITUACAO } from "@/lib/xml";

export type LinhaGrade = { id: string; nome: string; codigo: string; ie: string; aviso: string;
  celulas: ({ chave: string; mensagem: string } | null)[] };
export default function GradeTarefas({ linhas, colunas, filtro }: { linhas: LinhaGrade[]; colunas: string[]; filtro: string | null }) {
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const termo = useDeferredValue(busca).trim().toLocaleLowerCase("pt-BR");
  const visiveis = linhas.filter((e) => !termo || `${e.nome} ${e.codigo} ${e.ie}`.toLocaleLowerCase("pt-BR").includes(termo)
    || (termo.replace(/\D/g, "").length >= 3 && e.ie.includes(termo.replace(/\D/g, ""))));
  const atual = Math.min(pagina, Math.max(1, Math.ceil(visiveis.length / 25)));
  return <div className="grade-listagem">
    <search className="listagem-busca"><label htmlFor="buscar-tarefas">Buscar empresa nesta execução</label>
      <input id="buscar-tarefas" type="search" placeholder="Nome, código, CNPJ ou IE" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} /></search>
    <Tabela rotulo="Tarefas por empresa e serviço" className="grade-tarefas">
      <table><caption className="sr">Tarefas por empresa e serviço</caption>
        <thead><tr><th scope="col">Empresa</th>{colunas.map((c) => <th scope="col" key={c}>{nomeTipo(c)}</th>)}</tr></thead>
        <tbody>{visiveis.slice((atual - 1) * 25, atual * 25).map((e) => <tr key={e.id}
          className={filtro ? e.celulas.some((c) => c?.chave === filtro) ? "linha-filtrada" : "linha-apagada" : undefined}>
          <th scope="row" className="grade-empresa"><b>{e.nome}</b>
            <span>{e.codigo && `${e.codigo} · `}{e.ie.length === 14 ? `CNPJ ${formatarDocumento(e.ie)}` : `IE ${formatarIe(e.ie)}`}</span>
            {e.aviso && <span className="grade-aviso">{e.aviso}</span>}
          </th>
          {e.celulas.map((c, i) => <td key={colunas[i]} data-vazio={!c || undefined}>
            {c ? c.mensagem ? <details className="tarefa-detalhe"><summary aria-label={`${nomeTipo(colunas[i])}: ${SITUACAO[c.chave]?.nome ?? c.chave}. Ver detalhe de ${e.nome}`}>
              <span className={`celula-tarefa status ${SITUACAO[c.chave]?.classe ?? "st-neutro"}${filtro === c.chave ? " destaque" : ""}`}>{SITUACAO[c.chave]?.nome ?? c.chave}</span>
              <span className="tarefa-ver">Ver detalhe</span></summary><p>{c.mensagem}</p></details>
              : <span className={`celula-tarefa status ${SITUACAO[c.chave]?.classe ?? "st-neutro"}`}>{SITUACAO[c.chave]?.nome ?? c.chave}</span>
              : <span className="suave">—</span>}
          </td>)}
        </tr>)}</tbody>
      </table>
    </Tabela>
    {!visiveis.length && <p className="listagem-vazia" role="status">Nenhuma empresa encontrada. Tente outro nome ou documento.</p>}
    <Paginacao total={visiveis.length} pagina={atual} aoMudar={setPagina} rotulo="Paginação das tarefas" />
    <p className="suave">Toque ou clique em “Ver detalhe” para consultar a mensagem de cada tarefa.</p>
  </div>;
}
