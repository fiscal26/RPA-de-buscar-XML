import AutoRefresh from "@/components/AutoRefresh";
import { chaveEmpresa } from "@/lib/empresas";
import Tabela from "@/components/ui/Tabela";
import Link from "next/link";
import Icone from "@/components/Icones";
import { contexto } from "@/lib/sessao";
import { competenciaBR, dataHoraBR, formatarDocumento, formatarIe } from "@/lib/documentos";
import { resumoPainel, type AgendamentoPainel, type TarefaPainel } from "@/lib/painel";
import AcoesRecolhidas from "./AcoesRecolhidas";

const numero = (n: number) => n.toLocaleString("pt-BR");

export default async function Inicio() {
  const { supabase, perfil, admin } = await contexto();
  const gerencia = admin || perfil.papel === "gestor";
  const [{ data: agendamentos }, { data: tarefas }, { data: empresasSefaz }, { data: empresasNfse }, { data: robos }, { count: pessoas }] = await Promise.all([
    supabase.from("xml_agendamentos").select("id, competencia, criado_em, origem").order("criado_em", { ascending: false }).limit(50),
    supabase.from("xml_tarefas")
      .select("id, org_id, agendamento_id, ie, nome, status, mensagem, tipos, detalhes, concluido_em, xml_empresas(xml_acessos(login))")
      .order("criado_em", { ascending: false }).limit(5000),
    supabase.from("xml_empresas").select("id, org_id, cnpj, ie"),
    supabase.from("xml_nfse_empresas").select("id, org_id, cnpj"),
    // o robô é da operação: só o administrador consulta e vê
    admin ? supabase.from("xml_robos").select("id, ultimo_sinal").order("ultimo_sinal", { ascending: false }).limit(1)
          : Promise.resolve({ data: [] as { id: string; ultimo_sinal: string }[] }),
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

  const passos = [
    { feito: !!empresas, titulo: "Preencher a planilha modelo",
      texto: "SEFAZ: inscrição estadual e login do contador. NFS-e: CNPJ e o certificado A1 em Certificados.", href: "/painel/agendar" },
    // ligar o robô é com a LotiVisse: só o administrador vê esse passo
    ...(admin ? [{ feito: !!robo, titulo: "Ligar o robô",
      texto: "Ele roda junto com o Chrome e busca os agendamentos sozinho.", href: "/painel/agendamentos" }] : []),
    { feito: ags.length > 0, titulo: "Agendar a primeira competência",
      texto: "Envie a planilha e escolha o mês e a hora.", href: "/painel/agendar" },
    ...(gerencia ? [{ feito: (pessoas ?? 0) > 1, titulo: "Cadastrar a equipe",
      texto: "Cada pessoa do escritório com o próprio acesso.", href: "/painel/equipe" }] : []),
  ];
  const pendentes = passos.filter((p) => !p.feito).length;
  const acoes = r.acoes.length;

  return (
    <>
      <AutoRefresh ativo={r.abertas > 0} segundos={10} />
      <div className="cabeca-pagina">
        <div>
          <h1>Olá, {(perfil.nome || perfil.email).split(" ")[0]}</h1>
          <p className="suave">O resumo das execuções na SEFAZ e no Portal Nacional da NFS-e.</p>
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

      <div className="painel-numeros">
        <div className="numero-cartao">
          <span className="numero-icone"><Icone nome="empresas" /></span>
          <span className="nome">Empresas processadas</span>
          <span className="valor">{numero(r.empresasProcessadas)}</span>
          <span className="suave">de {numero(empresas)} cadastradas</span>
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
        <AcoesRecolhidas total={acoes}>
          <p className="suave">Empresas cujos documentos só voltam a sair depois de um ajuste seu. Estes avisos também ficam no sino, no alto da tela.</p>
          <ul className="acoes-lista">
            {r.acoes.map((a, i) => (
              <li key={`${a.ie}-${i}`}>
                <span className="acao-sinal" aria-hidden="true">!</span>
                <span className="acao-texto">
                  <b>{a.nome || "Empresa"}</b>
                  <span className="suave">
                    {a.ie.length === 14 ? `CNPJ ${formatarDocumento(a.ie)}` : `IE ${formatarIe(a.ie)}`}{a.quando ? `, ${dataHoraBR(a.quando)}` : ""}
                  </span>
                  <span>{a.motivo} {a.oQueFazer}</span>
                </span>
                <Link href={a.link} className="botao secundario">{a.botao}</Link>
              </li>
            ))}
          </ul>
        </AcoesRecolhidas>
      )}

      <section className="cartao">
        <div className="cartao-topo">
          <h2 className="titulo-cartao">Execuções</h2>
          {ags.length > 0 && <Link href="/painel/agendamentos" className="link-discreto">Ver todos os agendamentos</Link>}
        </div>
        {ags.length === 0 ? (
          <p className="suave">Quando o primeiro agendamento rodar, o resultado de cada execução aparecerá aqui.</p>
        ) : (
          <Tabela rotulo="Agendamentos recentes">
            <table>
              <caption className="sr">Agendamentos recentes</caption>
              <thead>
                <tr><th scope="col">Competência</th><th scope="col">Origem</th><th scope="col">Agendado em</th><th scope="col">Empresas</th><th scope="col">Tarefas realizadas</th><th scope="col">Empresas em dia</th><th scope="col">Taxa</th><th scope="col">Sua ação</th></tr>
              </thead>
              <tbody>
                {r.execucoes.slice(0, 10).map((e) => (
                  <tr key={e.id}>
                    <td><Link href={`/painel/agendamentos/${e.id}`}>{competenciaBR(e.competencia)}</Link></td>
                    <td>{e.origem === "nfse" ? "NFS-e" : "SEFAZ"}</td>
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
          </Tabela>
        )}
      </section>
    </>
  );
}
