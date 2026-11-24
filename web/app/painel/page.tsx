import AutoRefresh from "@/components/AutoRefresh";
import { chaveEmpresa } from "@/lib/empresas";
import Tabela from "@/components/ui/Tabela";
import Link from "next/link";
import Icone from "@/components/Icones";
import { contexto } from "@/lib/sessao";
import { competenciaBR, dataHoraBR, formatarDocumento, formatarIe } from "@/lib/documentos";
import { resumoPainel, type AgendamentoPainel, type TarefaPainel } from "@/lib/painel";
import { ROBO_ONLINE_SEGUNDOS } from "@/lib/xml";

const numero = (n: number) => n.toLocaleString("pt-BR");

function Pendencias({ acoes }: { acoes: ReturnType<typeof resumoPainel>["acoes"] }) {
  return (
    <ul className="visao-pendencias">
      {acoes.map((a, i) => (
        <li key={`${a.ie}-${i}`}>
          <div className="visao-pendencia-empresa">
            <b>{a.nome || "Empresa"}</b>
            <span>{a.ie.length === 14 ? `CNPJ ${formatarDocumento(a.ie)}` : `IE ${formatarIe(a.ie)}`}</span>
            {a.quando && <time dateTime={a.quando}>{dataHoraBR(a.quando)}</time>}
          </div>
          <div className="visao-pendencia-motivo"><b>{a.motivo}</b><span>{a.oQueFazer}</span></div>
          <Link href={a.link} className="botao secundario pequeno" aria-label={`${a.botao} para ${a.nome || a.ie}`}>{a.botao}</Link>
        </li>
      ))}
    </ul>
  );
}

export default async function Inicio() {
  const { supabase, perfil, admin } = await contexto();
  const gerencia = admin || perfil.papel === "gestor";
  const [{ data: agendamentos }, { data: tarefas }, { data: empresasSefaz }, { data: empresasNfse }, { data: robos, error: erroRobos }, { count: pessoas }] = await Promise.all([
    supabase.from("xml_agendamentos").select("id, competencia, criado_em, origem").order("criado_em", { ascending: false }).limit(50),
    supabase.from("xml_tarefas")
      .select("id, org_id, agendamento_id, ie, nome, status, mensagem, tipos, detalhes, concluido_em, xml_empresas(xml_acessos(login))")
      .order("criado_em", { ascending: false }).limit(5000),
    supabase.from("xml_empresas").select("id, org_id, cnpj, ie"),
    supabase.from("xml_nfse_empresas").select("id, org_id, cnpj"),
    // o robô é da operação: só o administrador consulta e vê
    admin ? supabase.from("xml_robos").select("id, ultimo_sinal").order("ultimo_sinal", { ascending: false }).limit(1)
          : Promise.resolve({ data: [] as { id: string; ultimo_sinal: string }[], error: null }),
    supabase.from("perfis").select("id", { count: "exact", head: true }),
  ]);
  const ags = (agendamentos ?? []) as AgendamentoPainel[];
  const cadastros = [
    ...(empresasSefaz ?? []).map((x) => ({ ...x, origem: "sefaz" })),
    ...(empresasNfse ?? []).map((x) => ({ ...x, ie: x.cnpj, origem: "nfse" })),
  ];
  const identidades = new Map(cadastros.map((x) => [JSON.stringify([x.org_id, x.origem, x.ie]), chaveEmpresa(x)]));
  const origens = new Map(ags.map((a) => [a.id, a.origem ?? "sefaz"]));
  const r = resumoPainel(((tarefas ?? []) as unknown as (TarefaPainel & { org_id: string })[]).map((t) => {
    const origem = origens.get(t.agendamento_id) ?? (t.tipos.some((tipo) => tipo.startsWith("nfse")) ? "nfse" : "sefaz");
    return { ...t, origem, empresaChave: identidades.get(JSON.stringify([t.org_id, origem, t.ie]))
      ?? chaveEmpresa({ org_id: t.org_id, cnpj: origem === "nfse" ? t.ie : "", origem, id: t.ie }) };
  }), ags);
  const empresas = new Set(cadastros.map(chaveEmpresa)).size;
  const robo = robos?.[0];
  const roboOnline = !!robo && Date.now() - Date.parse(robo.ultimo_sinal) < ROBO_ONLINE_SEGUNDOS * 1000;
  const estadoRobo = erroRobos ? "Estado indisponível" : !robo ? "Sem comunicação" : roboOnline ? "Online" : "Offline";

  const passos = [
    { feito: !!empresas, titulo: "Cadastrar empresas",
      texto: "Cadastre uma empresa ou importe a planilha pelo agendamento.", href: "/painel/empresas" },
    // ligar o robô é com a LotiVisse: só o administrador vê esse passo
    ...(admin ? [{ feito: !!robo, titulo: "Ligar o robô",
      texto: "Ele roda junto com o Chrome e busca os agendamentos sozinho.", href: "/painel/agendamentos" }] : []),
    { feito: ags.length > 0, titulo: "Agendar a primeira competência",
      texto: "Escolha as empresas, a competência e o horário de execução.", href: "/painel/agendar" },
    ...(gerencia ? [{ feito: (pessoas ?? 0) > 1, titulo: "Cadastrar a equipe",
      texto: "Cada pessoa do escritório com o próprio acesso.", href: "/painel/equipe" }] : []),
  ];
  const proximoPasso = passos.find((p) => !p.feito);
  const concluidos = passos.filter((p) => p.feito).length;
  const acoes = r.acoes.length;
  const finalizadas = r.realizadas + r.erros;
  const execucoes = r.execucoes.slice(0, 10);

  return (
    <>
      <AutoRefresh ativo={r.abertas > 0 || admin} segundos={r.abertas > 0 ? 10 : 60} />
      <header className="cabeca-pagina visao-cabeca">
        <h1>Visão geral</h1>
        <Link href="/painel/agendar" className="botao"><Icone nome="agendar" tamanho={18} />Agendar competência</Link>
      </header>

      {admin && (
        <section className="visao-robo" aria-labelledby="estado-robo">
          <div className="visao-robo-estado">
            <span className={roboOnline ? "visao-estado online" : "visao-estado"} aria-hidden="true" />
            <h2 id="estado-robo">Robô de consultas <span>{estadoRobo}</span></h2>
          </div>
          <div className="visao-robo-sinal">
            {robo && <>Última comunicação <time dateTime={robo.ultimo_sinal}>{dataHoraBR(robo.ultimo_sinal)}</time></>}
            {!robo && !erroRobos && "Nenhuma comunicação registrada"}
            {erroRobos && "Consulta do estado temporariamente indisponível"}
          </div>
          {!roboOnline && <Link href="/painel/agendamentos">{erroRobos ? "Ver agendamentos" : "Ver fila de agendamentos"}</Link>}
        </section>
      )}

      <section className="visao-secao" id="acoes" aria-labelledby="titulo-pendencias">
        <div className="visao-secao-topo">
          <h2 id="titulo-pendencias">Pendências</h2>
          {acoes > 0 && <span className="visao-contagem"><Icone nome="alerta" tamanho={16} />{numero(acoes)} {acoes === 1 ? "empresa exige" : "empresas exigem"} intervenção</span>}
        </div>
        {acoes ? (
          <>
            <Pendencias acoes={r.acoes.slice(0, 2)} />
            {acoes > 2 && <details className="visao-mais">
              <summary>Mais {numero(acoes - 2)} {acoes === 3 ? "pendência" : "pendências"}</summary>
              <Pendencias acoes={r.acoes.slice(2)} />
            </details>}
          </>
        ) : <p className="visao-vazio"><Icone nome="visto" tamanho={17} />Nenhuma empresa exige intervenção.</p>}
      </section>

      <section className="visao-secao" aria-labelledby="titulo-indicadores">
        <div className="visao-secao-topo"><h2 id="titulo-indicadores">Indicadores de processamento</h2></div>
        <dl className="visao-indicadores">
          <div>
            <dt>Empresas processadas</dt>
            <dd><strong>{numero(r.empresasProcessadas)}</strong><span>de {numero(empresas)} cadastradas</span></dd>
          </div>
          <div>
            <dt>Agendamentos</dt>
            <dd><strong>{numero(r.agendamentos)}</strong><span>{ags[0] ? `Última competência ${competenciaBR(ags[0].competencia)}` : "Nenhuma competência agendada"}</span></dd>
          </div>
          <div>
            <dt>Tarefas realizadas</dt>
            <dd><strong>{numero(r.realizadas)}</strong><span><b>{numero(r.abertas)}</b> em andamento · <b>{numero(r.erros)}</b> com falha</span></dd>
          </div>
          <div>
            <dt>Empresas em dia</dt>
            <dd><strong>{numero(r.empresasOk)}</strong><span>{acoes > 0 ? <a href="#acoes">{numero(acoes)} {acoes === 1 ? "com pendência" : "com pendências"}</a> : "Sem pendências para resolver"}</span></dd>
          </div>
          <div className="visao-taxa">
            <dt>Taxa de sucesso</dt>
            <dd>
              <strong>{r.taxa === null ? "—" : `${r.taxa}%`}</strong>
              {r.taxa !== null && <span className="visao-taxa-trilho" aria-hidden="true"><span style={{ inlineSize: `${r.taxa}%` }} /></span>}
              <span>{r.taxa === null ? "Aguardando tarefas finalizadas" : `${numero(r.realizadas)} de ${numero(finalizadas)} finalizadas sem erro`}</span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="visao-secao" aria-labelledby="titulo-execucoes">
        <div className="visao-secao-topo">
          <h2 id="titulo-execucoes">Execuções</h2>
          {ags.length > 0 && <Link href="/painel/agendamentos" className="link-discreto">Ver todos os agendamentos <Icone nome="seta" tamanho={15} /></Link>}
        </div>
        {execucoes.length === 0 ? (
          <p className="visao-vazio">Os resultados aparecerão após o primeiro agendamento.</p>
        ) : (
          <Tabela rotulo="Agendamentos recentes" className="visao-execucoes">
            <table>
              <caption className="sr">Agendamentos recentes</caption>
              <thead>
                <tr>
                  <th scope="col">Competência</th><th scope="col">Origem</th><th scope="col">Agendado em</th>
                  <th scope="col" className="visao-num">Empresas</th><th scope="col" className="visao-num">Tarefas realizadas</th>
                  <th scope="col" className="visao-num">Em andamento</th><th scope="col" className="visao-num">Empresas em dia</th>
                  <th scope="col" className="visao-num">Sucesso</th><th scope="col" className="visao-num">Intervenção</th>
                </tr>
              </thead>
              <tbody>
                {execucoes.map((e) => {
                  const mes = competenciaBR(e.competencia);
                  const origem = e.origem === "nfse" ? "NFS-e" : "SEFAZ";
                  const agendadoEm = dataHoraBR(e.criado_em);
                  return (
                    <tr key={e.id}>
                      <th scope="row">
                        <Link href={`/painel/agendamentos/${e.id}`} aria-label={`Ver execução de ${mes} · ${origem} · ${agendadoEm}`}>{mes} <Icone nome="seta" tamanho={14} /></Link>
                      </th>
                      <td>{origem}</td>
                      <td><time dateTime={e.criado_em}>{agendadoEm}</time></td>
                      <td className="visao-num">{numero(e.empresas)}</td>
                      <td className="visao-num">{numero(e.realizadas)}</td>
                      <td className={`visao-num ${e.abertas ? "visao-em-curso" : "suave"}`}>{numero(e.abertas)}</td>
                      <td className="visao-num">{numero(e.ok)} <span className="suave">de {numero(e.empresas)}</span></td>
                      <td className="visao-num"><b>{e.taxa === null ? "—" : `${e.taxa}%`}</b></td>
                      <td className="visao-num">{e.acoes > 0 ? <span className="visao-contagem">{numero(e.acoes)} {e.acoes === 1 ? "empresa" : "empresas"}</span> : <span className="suave">Nenhuma</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Tabela>
        )}
      </section>

      {proximoPasso && (
        <details className="visao-configuracao">
          <summary>
            <span><b>Primeiros passos</b> <span className="suave">{concluidos} de {passos.length} concluídos</span></span>
            <span className="visao-proximo">Próximo passo <b>{proximoPasso.titulo}</b></span>
            <Icone nome="abaixo" tamanho={17} />
          </summary>
          <ol>
            {[...passos.filter((p) => !p.feito), ...passos.filter((p) => p.feito)].map((p) => (
              <li key={p.titulo} className={p.feito ? "feito" : undefined}>
                <span>{p.feito ? "Concluído" : "Pendente"}</span>
                <div><Link href={p.href}>{p.titulo}</Link><p>{p.texto}</p></div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
