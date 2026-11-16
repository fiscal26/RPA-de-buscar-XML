"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import Formulario from "@/components/ui/Formulario";
import PeriodoCompetencias from "@/components/ui/PeriodoCompetencias";
import AutoRefresh from "@/components/AutoRefresh";
import { dataBR, dataHoraBR, formatarDocumento } from "@/lib/documentos";
import {
  RESULTADOS_MEI,
  type DecisaoMei,
  type ItemDescoberta,
} from "@/lib/mei-acompanhamento";
import type { CadastroMei } from "@/lib/mei-carteira";
import {
  criarLoteMei,
  confirmarLoteMei,
  decidirAcompanhamentoMei,
  atualizarFaturamentoLoteMei,
  type EstadoDescoberta,
} from "../descoberta-actions";

type Props = {
  org: string;
  empresas: { cnpj: string; nome: string }[];
  cadastros: CadastroMei[];
  decisoes: DecisaoMei[];
  itens: ItemDescoberta[];
  lotes: { id: string; origem: string; estado: string; criado_em: string }[];
  lote?: string;
  pode: boolean;
  workerAtivo: boolean;
  competencia: string;
};
function Mensagem({ estado }: { estado: EstadoDescoberta }) {
  return (
    estado && (
      <p className={`faixa ${estado.erro ? "erro" : "ok"}`} role="status">
        {estado.erro || estado.ok}
      </p>
    )
  );
}
export default function GerenciarMeis(p: Props) {
  const [inicio, iniciar, iniciando] = useActionState(criarLoteMei, undefined);
  const [confirmacao, confirmar, confirmando] = useActionState(
    confirmarLoteMei,
    undefined,
  );
  const [fiscal, atualizar, atualizando] = useActionState(
    atualizarFaturamentoLoteMei,
    undefined,
  );
  const [excluidos, excluir] = useState<string[]>([]);
  const [selecionados, selecionar] = useState<string[]>([]);
  const [busca, buscar] = useState("");
  const [pagina, paginar] = useState(0);
  const [paginaLote, paginarLote] = useState(0);
  const [filtro, filtrar] = useState("todos");
  const pendentes = p.itens.filter((i) =>
    ["pendente", "processando"].includes(i.resultado),
  ).length;
  const elegiveis = p.itens.filter((i) => i.resultado === "elegivel");
  const quantidadeIncluir = elegiveis.filter((i) => !excluidos.includes(i.cnpj)).length;
  const terminou = p.itens.length - pendentes;
  const workerAtivo = p.workerAtivo;
  const decisoes = new Map(p.decisoes.map((d) => [d.cnpj, d]));
  const cadastros = new Map(p.cadastros.map((c) => [c.cnpj, c]));
  const estado = (cnpj: string) =>
    decisoes.get(cnpj)?.estado ??
    (cadastros.get(cnpj)?.ativo
      ? "ativo"
      : cadastros.has(cnpj)
        ? "pausado"
        : "ausente");
  const visiveis = p.empresas.filter(
    (e) =>
      `${e.nome} ${e.cnpj} ${formatarDocumento(e.cnpj)}`
        .toLowerCase()
        .includes(busca.toLowerCase()) &&
      (filtro === "todos" || estado(e.cnpj) === filtro),
  );
  const linhas = visiveis.slice(pagina * 30, pagina * 30 + 30);
  const competencia = p.competencia;
  return (
    <>
      <AutoRefresh
        ativo={pendentes > 0 || p.lotes.some((l) => l.estado === "aberto")}
        segundos={10}
      />
      <section className="cartao mei-gestao">
        <h2>Trazer MEIs cadastrados</h2>
        <p>
          Verifique os CNPJs da SEFAZ e da NFS-e deste escritório, sem duplicar
          empresas. As datas já confirmadas e as decisões de pausa ou exclusão
          serão preservadas.
        </p>
        {p.pode && (
          <Formulario action={iniciar}>
            <input type="hidden" name="org" value={p.org} />
            <button disabled={iniciando}>
              {iniciando ? "Iniciando…" : "Trazer MEIs cadastrados"}
            </button>
            <Mensagem estado={inicio} />
            {inicio?.lote && inicio.lote !== p.lote && (
              <Link
                className="botao secundario"
                href={`/painel/mei/gerenciar?org=${p.org}&lote=${inicio.lote}`}
              >
                Abrir lote iniciado
              </Link>
            )}
          </Formulario>
        )}
        <p className="suave">
          A verificação continua com a página fechada. As consultas respeitam o
          cache e o intervalo da CNPJá.{" "}
          {workerAtivo
            ? "Serviço de verificação conectado."
            : "Serviço sem sinal recente; os pedidos ficam guardados até ele voltar."}
        </p>
        {!!p.lotes.length && (
          <form action="/painel/mei/gerenciar" className="linha">
            <input type="hidden" name="org" value={p.org} />
            <label>
              Lote{" "}
              <select name="lote" defaultValue={p.lote}>
                {p.lotes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {dataHoraBR(l.criado_em)} ·{" "}
                    {
                      (
                        {
                          manual: "Carteira existente",
                          automatico: "Novo cadastro",
                          indicacao: "Indicação em XML",
                          periodico: "Revisão periódica",
                        } as Record<string, string>
                      )[l.origem]
                    }{" "}
                    · {l.estado === "aberto" ? "Em andamento" : "Verificado"}
                  </option>
                ))}
              </select>
            </label>
            <button className="secundario">Abrir lote</button>
          </form>
        )}
        {p.lote && (
          <>
            <p role="status">
              Verificadas: {terminou} de {p.itens.length} · prontas para incluir: {elegiveis.length} · aguardando: {pendentes}
            </p>
            <progress
              className="mei-progresso"
              value={terminou}
              max={Math.max(1, p.itens.length)}
              aria-label="Verificação dos CNPJs"
            />
            <div className="mei-verificacoes">
              {p.itens.slice(paginaLote * 30, paginaLote * 30 + 30).map((i) => (
                <article key={i.id} className="mei-verificacao">
                  <div className="linha">
                    <b>{i.nome}</b>
                    <span
                      className={`status ${i.resultado === "elegivel" || i.resultado === "incluido" ? "st-ok" : "st-neutro"}`}
                    >
                      {RESULTADOS_MEI[i.resultado] ?? i.resultado}
                    </span>
                  </div>
                  <p className="suave">{formatarDocumento(i.cnpj)}</p>
                  {i.dados && (
                    <p>
                      Abertura:{" "}
                      {i.dados.abertura
                        ? dataBR(i.dados.abertura)
                        : "não informada"}{" "}
                      · Início no SIMEI:{" "}
                      {i.dados.inicioMei
                        ? dataBR(i.dados.inicioMei)
                        : "não informado"}{" "}
                      · MEI:{" "}
                      {i.dados.mei === true
                        ? "Sim"
                        : i.dados.mei === false
                          ? "Não"
                          : "não informado"}
                    </p>
                  )}
                  {i.consultado_em && (
                    <p className="suave">
                      Fonte: CNPJá · consulta {dataHoraBR(i.consultado_em)}
                      {i.dados?.atualizadoEm &&
                        ` · base atualizada em ${dataHoraBR(i.dados.atualizadoEm)}`}
                    </p>
                  )}
                  <p>{i.mensagem}</p>
                  {i.resultado === "elegivel" && p.pode && (
                    <label className="caixa-opcao">
                      <input
                        type="checkbox"
                        value={i.cnpj}
                        checked={!excluidos.includes(i.cnpj)}
                        onChange={(e) =>
                          excluir((x) =>
                            e.target.checked
                              ? x.filter((c) => c !== i.cnpj)
                              : [...x, i.cnpj],
                          )
                        }
                      />
                      Incluir {i.nome} no monitoramento
                    </label>
                  )}
                  {["revisar", "nao_mei", "erro"].includes(i.resultado) &&
                    p.pode && (
                      <Link
                        href={`/painel/mei/gerenciar?org=${p.org}&cnpj=${i.cnpj}#cadastro-mei`}
                      >
                        Conferir cadastro e datas
                      </Link>
                    )}
                  {p.pode && (
                    <Decisao
                      org={p.org}
                      cnpj={i.cnpj}
                      decisao={decisoes.get(i.cnpj)}
                      cadastro={cadastros.get(i.cnpj)}
                    />
                  )}
                </article>
              ))}
            </div>
            {p.itens.length > 30 && (
              <nav className="linha" aria-label="Páginas do lote">
                <button
                  className="secundario"
                  disabled={!paginaLote}
                  onClick={() => paginarLote(paginaLote - 1)}
                >
                  Lote: anterior
                </button>
                <span>
                  {paginaLote + 1} de {Math.ceil(p.itens.length / 30)}
                </span>
                <button
                  className="secundario"
                  disabled={(paginaLote + 1) * 30 >= p.itens.length}
                  onClick={() => paginarLote(paginaLote + 1)}
                >
                  Lote: próxima
                </button>
              </nav>
            )}
            <Formulario action={confirmar}>
              <input type="hidden" name="org" value={p.org} />
              <input type="hidden" name="lote" value={p.lote} />
              {elegiveis
                .filter((i) => !excluidos.includes(i.cnpj))
                .map((i) => (
                  <input
                    key={i.cnpj}
                    type="hidden"
                    name="cnpjs"
                    value={i.cnpj}
                  />
                ))}
              <p className="suave">
                Desmarcar deixa a inclusão para depois. Para impedir futuras
                inclusões, escolha “Ignorar este CNPJ” em Alterar
                acompanhamento.
              </p>
              {p.pode && elegiveis.length > 0 && (
                <button
                  disabled={
                    confirmando ||
                    elegiveis.every((i) => excluidos.includes(i.cnpj))
                  }
                >
                  {confirmando
                    ? "Incluindo…"
                    : `Incluir ${quantidadeIncluir} ${quantidadeIncluir === 1 ? "MEI selecionado" : "MEIs selecionados"}`}
                </button>
              )}
              <Mensagem estado={confirmacao} />
            </Formulario>
          </>
        )}
      </section>
      <section id="empresas-mei" className="cartao mei-gestao">
        <h2>Empresas e decisões do escritório</h2>
        <p>
          Pause para interromper o acompanhamento; ignore um CNPJ indevido.
          Essas decisões não exigem datas e não são desfeitas por importações.
          Encerrar o período mantém os anos anteriores visíveis.
        </p>
        <div className="linha">
          <label>
            Buscar empresa
            <input
              type="search"
              value={busca}
              onChange={(e) => {
                buscar(e.target.value);
                paginar(0);
              }}
            />
          </label>
          <label>
            Acompanhamento
            <select
              value={filtro}
              onChange={(e) => {
                filtrar(e.target.value);
                paginar(0);
              }}
            >
              <option value="todos">Todos</option>
              <option value="ativo">Ativos</option>
              <option value="pausado">Pausados</option>
              <option value="ignorado">Ignorados</option>
              <option value="ausente">Sem cadastro</option>
            </select>
          </label>
        </div>
        <p className="suave">
          Empresas: {visiveis.length} · selecionadas para atualizar faturamento: {selecionados.length}
        </p>
        {linhas.map((e) => {
          const c = cadastros.get(e.cnpj),
            d = decisoes.get(e.cnpj);
          return (
            <article className="mei-verificacao" key={e.cnpj}>
              <div className="linha">
                <b>{e.nome}</b>
                <span className="status st-neutro">
                  {
                    {
                      ativo: "Ativo",
                      pausado: "Pausado",
                      ignorado: "Ignorado",
                      ausente: "Sem cadastro",
                    }[estado(e.cnpj)]
                  }
                </span>
              </div>
              <p className="suave">
                {formatarDocumento(e.cnpj)}
                {d &&
                  ` · decisão ${d.origem === "legado" ? "anterior" : d.origem}`}
                {d?.motivo && ` · ${d.motivo}`}
              </p>
              {c && (
                <p>
                  Abertura: {dataBR(c.inicio_atividade)} · MEI desde{" "}
                  {dataBR(c.inicio_mei)}
                  {c.fim_mei && ` até ${dataBR(c.fim_mei)}`}
                </p>
              )}
              <div className="linha">
                {c && (
                  <Link
                    href={`/painel/mei/${e.cnpj}?org=${p.org}${c.fim_mei ? `&ano=${c.fim_mei.slice(0, 4)}` : ""}`}
                  >
                    Histórico fiscal
                  </Link>
                )}
                {p.pode && (
                  <Link
                    href={`/painel/mei/gerenciar?org=${p.org}&cnpj=${e.cnpj}#cadastro-mei`}
                  >
                    Editar cadastro
                  </Link>
                )}
              </div>
              {p.pode && (
                <Decisao org={p.org} cnpj={e.cnpj} decisao={d} cadastro={c} />
              )}
              {p.pode && estado(e.cnpj) === "ativo" && (
                <label className="caixa-opcao">
                  <input
                    type="checkbox"
                    checked={selecionados.includes(e.cnpj)}
                    onChange={(ev) =>
                      selecionar((x) =>
                        ev.target.checked
                          ? [...x, e.cnpj]
                          : x.filter((c) => c !== e.cnpj),
                      )
                    }
                  />
                  Atualizar faturamento de {e.nome}
                </label>
              )}
            </article>
          );
        })}
        {!linhas.length && (
          <p className="suave">Nenhuma empresa neste filtro.</p>
        )}
        {visiveis.length > 30 && (
          <nav className="linha" aria-label="Páginas de empresas">
            <button
              className="secundario"
              disabled={!pagina}
              onClick={() => paginar(pagina - 1)}
            >
              Anterior
            </button>
            <span>
              Página {pagina + 1} de {Math.ceil(visiveis.length / 30)}
            </span>
            <button
              className="secundario"
              disabled={(pagina + 1) * 30 >= visiveis.length}
              onClick={() => paginar(pagina + 1)}
            >
              Próxima
            </button>
          </nav>
        )}
        {p.pode && (
          <details className="empresas-painel">
            <summary>Atualizar faturamento dos MEIs selecionados</summary>
            <div className="empresas-painel-corpo">
              <p>
                A consulta cadastral não traz faturamento. Os valores já
                importados são reaproveitados; ausência de consulta continua
                como “aguardando”, sem virar zero.
              </p>
              <Formulario action={atualizar}>
                <input type="hidden" name="org" value={p.org} />
                {selecionados.map((c) => (
                  <input key={c} type="hidden" name="cnpjs" value={c} />
                ))}
                <PeriodoCompetencias
                  competencia={competencia}
                  minimo="2018-01"
                />
                <button disabled={atualizando || !selecionados.length}>
                  {atualizando
                    ? "Agendando…"
                    : `Atualizar faturamento (${selecionados.length})`}
                </button>
                <Mensagem estado={fiscal} />
                {fiscal?.resultados?.map((r) => (
                  <div key={r.cnpj}>
                    <b>{formatarDocumento(r.cnpj)}</b>
                    {r.erro ? (
                      <p className="texto-erro">{r.erro}</p>
                    ) : (
                      <ul>
                        {r.consultas?.map((c) => (
                          <li key={c.id}>
                            <Link href={`/painel/agendamentos/${c.id}`}>
                              {c.competencia} · {c.origem}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </Formulario>
            </div>
          </details>
        )}
      </section>
    </>
  );
}
function Decisao({
  org,
  cnpj,
  decisao,
  cadastro,
}: {
  org: string;
  cnpj: string;
  decisao?: DecisaoMei;
  cadastro?: CadastroMei;
}) {
  const [estado, acao, pendente] = useActionState(
    decidirAcompanhamentoMei,
    undefined,
  );
  const [tipo, mudar] = useState("pausar");
  return (
    <details className="mei-decisao">
      <summary>Alterar acompanhamento</summary>
      <Formulario action={acao} className="formulario">
        <input type="hidden" name="org" value={org} />
        <input type="hidden" name="cnpj" value={cnpj} />
        <input type="hidden" name="versao" value={decisao?.versao ?? 0} />
        <label>
          Decisão
          <select
            name="acao"
            value={tipo}
            onChange={(e) => mudar(e.target.value)}
          >
            <option value="pausar">Pausar acompanhamento</option>
            <option value="ignorar">Ignorar este CNPJ</option>
            {cadastro && (
              <>
                <option value="reativar">Reativar acompanhamento</option>
                <option value="encerrar">Encerrar período MEI</option>
              </>
            )}
          </select>
        </label>
        {tipo === "encerrar" && (
          <label>
            Último mês como MEI
            <input
              type="month"
              name="fim"
              min={cadastro?.inicio_mei.slice(0, 7)}
              required
            />
          </label>
        )}
        <label>
          Motivo (opcional)
          <input name="motivo" maxLength={240} />
        </label>
        <button className="secundario" disabled={pendente}>
          {pendente ? "Registrando…" : "Confirmar decisão"}
        </button>
        <Mensagem estado={estado} />
      </Formulario>
    </details>
  );
}
