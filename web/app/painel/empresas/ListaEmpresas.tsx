"use client";

import Link from "next/link";
import { transicaoSuave } from "@/lib/transicao";
import { useDeferredValue, useRef, useState } from "react";
import Icone from "@/components/Icones";
import Escolha from "@/components/ui/Escolha";
import { formatarDocumento, formatarIe } from "@/lib/documentos";
import { removerEmpresa } from "../actions";
import Renomear from "./Renomear";
import BotaoRemover from "./BotaoRemover";

import type { EmpresaAgrupada } from "@/lib/empresas";

function AcoesEmpresa({ empresa }: { empresa: EmpresaAgrupada }) {
  const x = empresa;
  const dialogo = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" className="fantasma empresa-mais" aria-label={`Ações de ${x.nome}`}
      aria-haspopup="dialog" onClick={() => dialogo.current?.showModal()}><span aria-hidden="true">•••</span></button>
    <dialog ref={dialogo} className="dialogo empresa-dialogo" aria-label={`Gerenciar ${x.nome}`}>
      {empresa.cadastros.map((x) => <div key={`${x.origem}-${x.id}`} className="dialogo-corpo">
        <h2>Gerenciar empresa</h2>
        <p className="suave">{x.origem === "sefaz" ? "SEFAZ" : "NFS-e"} · {formatarDocumento(x.cnpj) || "Documento não informado"}</p>
        <div className="empresa-edicao"><Renomear id={x.id} nome={x.nome} fixo={x.fixo} origem={x.origem} /></div>
        <dl className="empresa-dados">
          <div><dt>Código na planilha</dt><dd>{x.codigo || "Não informado"}</dd></div>
          {x.escritorio && <div><dt>Organização</dt><dd>{x.escritorio}</dd></div>}
          {x.ie && <div><dt>Inscrição estadual</dt><dd>{formatarIe(x.ie)}</dd></div>}
          <div><dt>Acesso</dt><dd>{x.acesso}{x.acessoDetalhe && ` · ${x.acessoDetalhe}`}</dd></div>
          <div><dt>Serviços</dt><dd>{x.servicos || "Não informados"}</dd></div>
        </dl>
        {x.origem === "nfse" && <Link href="/painel/certificados">Gerenciar certificados</Link>}
        <form action={removerEmpresa}>
          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="origem" value={x.origem} />
          <BotaoRemover apelido={x.nome} />
        </form>
      </div>)}
      <div className="dialogo-rodape empresa-dialogo-rodape">
        <button type="button" className="secundario" onClick={() => dialogo.current?.close()}>Fechar</button>
      </div>
    </dialog>
  </>;
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const filtros = [
  { id: "todos", nome: "Total" }, { id: "sefaz", nome: "SEFAZ" }, { id: "nfse", nome: "NFS-e" },
  { id: "mei", nome: "MEI acompanhado" }, { id: "pendencias", nome: "Acesso com pendência" },
] as const;
type Filtro = typeof filtros[number]["id"];
const corresponde = (x: EmpresaAgrupada, f: Filtro) => f === "todos" || (f === "mei" ? x.mei === "ativo" : f === "pendencias" ? x.pendencia : x.cadastros.some((c) => c.origem === f));

export default function ListaEmpresas({ empresas }: { empresas: EmpresaAgrupada[] }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState("nome");
  const [pagina, setPagina] = useState(1);
  const buscaAdiada = useDeferredValue(busca);
  const termo = normalizar(buscaAdiada.trim()), digitos = buscaAdiada.replace(/\D/g, "");
  const selecionadas = empresas.filter((x) => corresponde(x, filtro) && (!termo ||
    x.cadastros.some((c) => normalizar(`${c.nome} ${c.cnpj} ${c.ie ?? ""} ${c.codigo} ${c.escritorio}`).includes(termo)) ||
    (digitos.length >= 3 && /^[\d\s./-]+$/.test(buscaAdiada) && x.cadastros.some((c) => [c.cnpj, c.ie ?? ""].some((documento) => documento.replace(/\D/g, "").includes(digitos))))))
    .sort((a, b) => ordem === "pendencias" ? Number(b.pendencia) - Number(a.pendencia) || a.nome.localeCompare(b.nome, "pt-BR") : a.nome.localeCompare(b.nome, "pt-BR"));
  const paginas = Math.max(1, Math.ceil(selecionadas.length / 25));
  const atual = Math.min(pagina, paginas), inicio = (atual - 1) * 25;
  function limpar() { setBusca(""); setFiltro("todos"); setPagina(1); }
  return <section className="empresas-listagem" aria-label="Lista de empresas">
    <div className="empresas-filtros" aria-label="Filtrar cadastros">
      {filtros.map((f) => <button type="button" key={f.id} className="secundario empresa-filtro" aria-pressed={filtro === f.id}
        onClick={() => transicaoSuave(() => { setFiltro(f.id); setPagina(1); })}><strong>{empresas.filter((x) => corresponde(x, f.id)).length}</strong>{f.nome}</button>)}
    </div>
    <div className="empresas-ferramentas">
      <div className="empresas-busca"><Icone nome="busca" tamanho={18} />
        <input type="search" aria-label="Buscar empresas" placeholder="Buscar por nome, CNPJ, CPF ou IE" value={busca}
          onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
      </div>
      <div className="empresas-ordem"><Escolha rotulo="Ordenar empresas" compacta avatar={false} valor={ordem}
        aoMudar={(v) => transicaoSuave(() => { setOrdem(v); setPagina(1); })} opcoes={[{ id: "nome", titulo: "Nome: A a Z" }, { id: "pendencias", titulo: "Pendências primeiro" }]} /></div>
    </div>
    <div className="empresas-tabela">
      <table aria-label="Cadastros de empresas">
        <thead><tr><th scope="col">Empresa</th><th scope="col">Origem e serviços</th><th scope="col">Acesso do robô</th><th scope="col">Monitoramento MEI</th><th scope="col">Ações</th></tr></thead>
        <tbody>{selecionadas.slice(inicio, inicio + 25).map((x) => <tr key={x.chave}>
          <td className="empresa-identidade"><strong>{x.nome}</strong><span>{formatarDocumento(x.cnpj) || "Documento não informado"}</span>
            <small>{[x.escritorio, x.codigo && `Cód. ${x.codigo}`, x.ie && `IE ${formatarIe(x.ie)}`].filter(Boolean).join(" · ")}</small></td>
          <td data-label="Origem e serviços"><span className="empresa-origem">{[...new Set(x.cadastros.map((c) => c.origem === "sefaz" ? "SEFAZ" : "NFS-e"))].join(" & ")}</span></td>
          <td data-label="Acesso do robô">{x.cadastros.map((c) => <div key={`${c.origem}-${c.id}`}><span className={`status ${c.acessoClasse}`}>{c.acesso}</span><span className="empresa-apoio">{x.cadastros.length > 1 && `${c.origem === "sefaz" ? "SEFAZ" : "NFS-e"} · `}{c.acessoDetalhe}</span></div>)}</td>
          <td data-label="Monitoramento MEI">{x.mei === "ativo" ? <><span className="status st-ok">Acompanhando</span><span className="empresa-apoio">Cadastro MEI ativo</span></>
            : x.mei === "ignorado" ? <span className="status st-neutro">Ignorado</span>
            : x.mei === "pausado" ? <span className="status st-neutro">Pausado</span>
            : <span className="empresa-apoio">{x.mei === "indisponivel" ? "Cadastro indisponível" : "Sem cadastro manual"}</span>}</td>
          <td className="empresa-acoes"><AcoesEmpresa empresa={x} /></td>
        </tr>)}</tbody>
      </table>
      {!selecionadas.length && <div className="empresas-vazio"><h2>{empresas.length ? "Nenhuma empresa encontrada" : "Sua lista de empresas começa aqui"}</h2>
        <p className="suave">{empresas.length ? "Tente outro nome, documento ou filtro." : "Importe a planilha em um agendamento para cadastrar suas empresas."}</p>
        {empresas.length ? <button type="button" className="secundario" onClick={limpar}>Limpar busca e filtros</button> : <Link className="botao" href="/painel/agendar">Importar empresas</Link>}</div>}
    </div>
    <div className="empresas-rodape"><span role="status">{selecionadas.length ? `${inicio + 1}–${Math.min(inicio + 25, selecionadas.length)} de ${selecionadas.length} empresas` : "0 empresas"}</span>
      {paginas > 1 && <nav aria-label="Paginação das empresas"><button type="button" className="secundario pequeno" disabled={atual === 1} onClick={() => transicaoSuave(() => setPagina(atual - 1))}>Anterior</button>
        <span>Página {atual} de {paginas}</span><button type="button" className="secundario pequeno" disabled={atual === paginas} onClick={() => transicaoSuave(() => setPagina(atual + 1))}>Próxima</button></nav>}
    </div>
  </section>;
}
