"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import Icone from "@/components/Icones";
import Escolha from "@/components/ui/Escolha";
import { formatarDocumento, formatarIe } from "@/lib/documentos";
import { removerEmpresa } from "../actions";
import Renomear from "./Renomear";
import BotaoRemover from "./BotaoRemover";

export type LinhaEmpresa = {
  id: string; origem: "sefaz" | "nfse"; nome: string; fixo: boolean; cnpj: string; codigo: string;
  escritorio: string; ie?: string; servicos: string; acesso: string; acessoDetalhe: string;
  acessoClasse: string; pendencia: boolean; mei: "ativo" | "pausado" | "ausente" | "indisponivel";
};

function AcoesEmpresa({ empresa: x }: { empresa: LinhaEmpresa }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" className="fantasma empresa-mais" aria-label={`Ações de ${x.nome} (${x.origem === "sefaz" ? "SEFAZ" : "NFS-e"})`}
      aria-haspopup="dialog" onClick={() => dialogo.current?.showModal()}><span aria-hidden="true">•••</span></button>
    <dialog ref={dialogo} className="dialogo empresa-dialogo" aria-label={`Gerenciar ${x.nome}`}>
      <div className="dialogo-corpo">
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
      </div>
      <div className="dialogo-rodape empresa-dialogo-rodape">
        <form action={removerEmpresa}>
          <input type="hidden" name="id" value={x.id} /><input type="hidden" name="origem" value={x.origem} />
          <BotaoRemover apelido={x.nome} />
        </form>
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
const corresponde = (x: LinhaEmpresa, f: Filtro) => f === "todos" || (f === "mei" ? x.mei === "ativo" : f === "pendencias" ? x.pendencia : x.origem === f);

export default function ListaEmpresas({ empresas }: { empresas: LinhaEmpresa[] }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState("nome");
  const [pagina, setPagina] = useState(1);
  const termo = normalizar(busca.trim()), digitos = busca.replace(/\D/g, "");
  const selecionadas = empresas.filter((x) => corresponde(x, filtro) && (!termo ||
    normalizar(`${x.nome} ${x.cnpj} ${x.ie ?? ""} ${x.codigo} ${x.escritorio}`).includes(termo) ||
    (digitos.length >= 3 && /^[\d\s./-]+$/.test(busca) && `${x.cnpj} ${x.ie ?? ""}`.includes(digitos))))
    .sort((a, b) => ordem === "pendencias" ? Number(b.pendencia) - Number(a.pendencia) || a.nome.localeCompare(b.nome, "pt-BR") : a.nome.localeCompare(b.nome, "pt-BR"));
  const paginas = Math.max(1, Math.ceil(selecionadas.length / 25));
  const atual = Math.min(pagina, paginas), inicio = (atual - 1) * 25;
  function limpar() { setBusca(""); setFiltro("todos"); setPagina(1); }
  return <section className="empresas-listagem" aria-label="Lista de empresas">
    <div className="empresas-filtros" aria-label="Filtrar cadastros">
      {filtros.map((f) => <button type="button" key={f.id} className="secundario empresa-filtro" aria-pressed={filtro === f.id}
        onClick={() => { setFiltro(f.id); setPagina(1); }}><strong>{empresas.filter((x) => corresponde(x, f.id)).length}</strong>{f.nome}</button>)}
    </div>
    <div className="empresas-ferramentas">
      <div className="empresas-busca"><Icone nome="busca" tamanho={18} />
        <input type="search" aria-label="Buscar empresas" placeholder="Buscar por nome, CNPJ, CPF ou IE" value={busca}
          onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
      </div>
      <div className="empresas-ordem"><Escolha rotulo="Ordenar empresas" compacta avatar={false} valor={ordem}
        aoMudar={(v) => { setOrdem(v); setPagina(1); }} opcoes={[{ id: "nome", titulo: "Nome: A a Z" }, { id: "pendencias", titulo: "Pendências primeiro" }]} /></div>
    </div>
    <div className="empresas-tabela">
      <table aria-label="Cadastros de empresas">
        <thead><tr><th scope="col">Empresa</th><th scope="col">Origem e serviços</th><th scope="col">Acesso do robô</th><th scope="col">Monitoramento MEI</th><th scope="col">Ações</th></tr></thead>
        <tbody>{selecionadas.slice(inicio, inicio + 25).map((x) => <tr key={`${x.origem}-${x.id}`}>
          <td className="empresa-identidade"><strong>{x.nome}</strong><span>{formatarDocumento(x.cnpj) || "Documento não informado"}</span>
            <small>{[x.escritorio, x.codigo && `Cód. ${x.codigo}`, x.ie && `IE ${formatarIe(x.ie)}`].filter(Boolean).join(" · ")}</small></td>
          <td data-label="Origem e serviços"><span className="empresa-origem">{x.origem === "sefaz" ? "SEFAZ" : "NFS-e"}</span><span className="empresa-apoio">{x.servicos || "Sem serviços"}</span></td>
          <td data-label="Acesso do robô"><span className={`status ${x.acessoClasse}`}>{x.acesso}</span><span className="empresa-apoio">{x.acessoDetalhe}</span></td>
          <td data-label="Monitoramento MEI">{x.mei === "ativo" ? <><span className="status st-ok">Acompanhando</span><span className="empresa-apoio">Cadastro MEI ativo</span></>
            : x.mei === "pausado" ? <span className="status st-neutro">Pausado</span>
            : <span className="empresa-apoio">{x.mei === "indisponivel" ? "Cadastro indisponível" : "Sem cadastro manual"}</span>}</td>
          <td className="empresa-acoes"><AcoesEmpresa empresa={x} /></td>
        </tr>)}</tbody>
      </table>
      {!selecionadas.length && <div className="empresas-vazio"><h2>{empresas.length ? "Nenhuma empresa encontrada" : "Sua lista de empresas começa aqui"}</h2>
        <p className="suave">{empresas.length ? "Tente outro nome, documento ou filtro." : "Importe a planilha em um agendamento para cadastrar suas empresas."}</p>
        {empresas.length ? <button type="button" className="secundario" onClick={limpar}>Limpar busca e filtros</button> : <Link className="botao" href="/painel/agendar">Importar empresas</Link>}</div>}
    </div>
    <div className="empresas-rodape"><span role="status">{selecionadas.length ? `${inicio + 1}–${Math.min(inicio + 25, selecionadas.length)} de ${selecionadas.length} cadastros` : "0 cadastros"}</span>
      {paginas > 1 && <nav aria-label="Paginação das empresas"><button type="button" className="secundario pequeno" disabled={atual === 1} onClick={() => setPagina(atual - 1)}>Anterior</button>
        <span>Página {atual} de {paginas}</span><button type="button" className="secundario pequeno" disabled={atual === paginas} onClick={() => setPagina(atual + 1)}>Próxima</button></nav>}
    </div>
  </section>;
}
