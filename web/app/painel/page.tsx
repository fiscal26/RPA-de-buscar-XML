import Link from "next/link";
import Icone from "@/components/Icones";
import { contexto } from "@/lib/sessao";
import { competenciaBR, dataHoraBR, formatarIe } from "@/lib/documentos";
import { resumoPainel, type AgendamentoPainel, type TarefaPainel } from "@/lib/painel";

const ROBO_ONLINE_SEGUNDOS = 120;
const numero = (n: number) => n.toLocaleString("pt-BR");

export default async function Inicio() {
  const { supabase, perfil, admin } = await contexto();
  const gerencia = admin || perfil.papel === "gestor";
  const [{ data: agendamentos }, { data: tarefas }, { count: empresas }, { data: robos }, { count: pessoas }] = await Promise.all([
    supabase.from("xml_agendamentos").select("id, competencia, criado_em").order("criado_em", { ascending: false }).limit(50),
    supabase.from("xml_tarefas")
      .select("id, agendamento_id, ie, nome, status, mensagem, tipos, detalhes, concluido_em, xml_empresas(xml_acessos(login))")
      .order("criado_em", { ascending: false }).limit(5000),
    supabase.from("xml_empresas").select("id", { count: "exact", head: true }),
    // o robô é da operação: só o administrador consulta e vê
    admin ? supabase.from("xml_robos").select("id, ultimo_sinal").order("ultimo_sinal", { ascending: false }).limit(1)
          : Promise.resolve({ data: [] as { id: string; ultimo_sinal: string }[] }),
    supabase.from("perfis").select("id", { count: "exact", head: true }),
  ]);
  const ags = (agendamentos ?? []) as AgendamentoPainel[];
  const r = resumoPainel((tarefas ?? []) as unknown as TarefaPainel[], ags);
  const robo = robos?.[0];
  const roboLigado = !!robo && Date.now() - Date.parse(robo.ultimo_sinal) < ROBO_ONLINE_SEGUNDOS * 1000;

  const passos = [
    { feito: !!empresas, titulo: "Preencher a planilha modelo",
      texto: "Inscrição estadual, nome e o login do contador no ATF de cada empresa.", href: "/painel/agendar" },
    // ligar o robô é com a LotiVisse: só o administrador vê esse passo
    ...(admin ? [{ feito: !!robo, titulo: "Ligar o robô",
      texto: "Ele roda junto do Chrome e busca os agendamentos sozinho.", href: "/painel/agendamentos" }] : []),
    { feito: ags.length > 0, titulo: "Agendar a primeira competência",
      texto: "Envie a planilha e escolha o mês e a hora.", href: "/painel/agendar" },
    ...(gerencia ? [{ feito: (pessoas ?? 0) > 1, titulo: "Cadastrar a equipe",
      texto: "Cada pessoa do escritório com o próprio acesso.", href: "/painel/equipe" }] : []),
  ];
  const pendentes = passos.filter((p) => !p.feito).length;
  const acoes = r.acoes.length;

  return (
    <>
      <div className="cabeca-pagina">
        <div>
          <h1>Bem-vindo, {(perfil.nome || perfil.email).split(" ")[0]}</h1>
          <p className="suave">O resumo das execuções no ATF da SEFAZ-PB.</p>
        </div>
        <Link href="/painel/agendar" className="botao">Agendar competência</Link>
      </div>

      {pendentes > 0 && (
        <section className="cartao">
          <h2 className="titulo-cartao">Primeiros passos</h2>
          <p className="suave">Falta{pendentes > 1 ? "m" : ""} {pendentes} de {passos.length} para o escritório ficar pronto.</p>
          <ul className="passos-lista">
            {passos.map((p) => (
              <li key={p.titulo}>
                <Link href={p.href}>
                  <span className="passo-texto"><b>{p.titulo}</b><span>{p.texto}</span></span>
                  <span className={`passo-situacao ${p.feito ? "feito" : ""}`}>{p.feito ? "Concluído" : "Pendente"}</span>
                  <Icone nome="seta" tamanho={18} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {admin && (
        <div className={`faixa ${roboLigado ? "ok" : "alerta"}`}>
          {roboLigado ? `Robô ligado (${robo!.id}).` : robo ? `Robô desligado. Último sinal em ${dataHoraBR(robo.ultimo_sinal)}.` : "O robô ainda não se conectou."}
          <span className="suave"> Só o administrador vê este aviso.</span>
        </div>
      )}

      <div className="painel-numeros">
        <div className="numero-cartao">
          <span className="numero-icone"><Icone nome="empresas" /></span>
          <span className="nome">Empresas processadas</span>
          <span className="valor">{numero(r.empresasProcessadas)}</span>
          <span className="suave">de {numero(empresas ?? 0)} cadastradas</span>
        </div>
        <div className="numero-cartao">
          <span className="numero-icone"><Icone nome="agendar" /></span>
          <span className="nome">Agendamentos realizados</span>
          <span className="valor">{numero(r.agendamentos)}</span>
          <span className="suave">{ags[0] ? `Último: ${competenciaBR(ags[0].competencia)}` : "Nenhum ainda"}</span>
        </div>
        <div className="numero-cartao">
          <span className="numero-icone"><Icone nome="tarefas" /></span>
          <span className="nome">Tarefas realizadas</span>
          <span className="valor">{numero(r.realizadas)}</span>
          <span className="suave">
            {r.realizadas ? `Nós realizamos ${numero(r.realizadas)} tarefa${r.realizadas > 1 ? "s" : ""} para você` : "Nenhuma tarefa ainda"}
            {r.abertas > 0 && `, ${numero(r.abertas)} em andamento`}
          </span>
        </div>
        <div className="numero-cartao">
          <span className="numero-icone"><Icone nome="visto" /></span>
          <span className="nome">Empresas em dia</span>
          <span className="valor">{numero(r.empresasOk)}</span>
          {acoes > 0
            ? <a href="#acoes" className="numero-alerta">+{acoes} precisa{acoes > 1 ? "m" : ""} da sua ação</a>
            : <span className="suave">nenhuma pendência sua</span>}
        </div>
        <div className="numero-cartao destaque">
          <span className="nome">Taxa de sucesso</span>
          <span className="valor">{r.taxa === null ? "—" : `${r.taxa}%`}</span>
          <span className="taxa-barra" aria-hidden="true"><span style={{ width: `${r.taxa ?? 0}%` }} /></span>
          <span className="suave">
            {r.taxa === null ? "Aparece depois da primeira execução" : `${numero(r.realizadas)} de ${numero(r.realizadas + r.erros)} tarefas concluídas`}
          </span>
        </div>
      </div>

      {acoes > 0 && (
        <section className="cartao" id="acoes">
          <h2 className="titulo-cartao">Precisa da sua ação</h2>
          <p className="suave">Empresas que só voltam a sair depois de um ajuste seu.</p>
          <ul className="acoes-lista">
            {r.acoes.map((a) => (
              <li key={a.ie}>
                <span className="acao-sinal" aria-hidden="true">!</span>
                <span className="acao-texto">
                  <b>{a.nome || "Empresa"}</b>
                  <span className="suave">IE {formatarIe(a.ie)}{a.quando ? ` · ${dataHoraBR(a.quando)}` : ""}</span>
                  <span>{a.motivo} {a.oQueFazer}</span>
                </span>
                <Link href={a.link} className="botao secundario">{a.botao}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cartao">
        <div className="cartao-topo">
          <h2 className="titulo-cartao">Execuções</h2>
          {ags.length > 0 && <Link href="/painel/agendamentos" className="link-discreto">Ver todos os agendamentos</Link>}
        </div>
        {ags.length === 0 ? (
          <p className="suave">Quando o primeiro agendamento rodar, o resultado de cada um aparece aqui.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr><th>Competência</th><th>Agendado em</th><th>Empresas</th><th>Tarefas realizadas</th><th>Empresas em dia</th><th>Taxa</th><th>Sua ação</th></tr>
              </thead>
              <tbody>
                {r.execucoes.slice(0, 10).map((e) => (
                  <tr key={e.id}>
                    <td><Link href={`/painel/agendamentos/${e.id}`}>{competenciaBR(e.competencia)}</Link></td>
                    <td>{dataHoraBR(e.criado_em)}</td>
                    <td>{e.empresas}</td>
                    <td>{e.realizadas}{e.abertas > 0 && <span className="suave"> (+{e.abertas} em andamento)</span>}</td>
                    <td>{e.ok} de {e.empresas}</td>
                    <td>{e.taxa === null ? "—" : `${e.taxa}%`}</td>
                    <td>{e.acoes > 0 ? <span className="status st-alerta">{e.acoes} empresa{e.acoes > 1 ? "s" : ""}</span> : <span className="status st-ok">Nenhuma</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
