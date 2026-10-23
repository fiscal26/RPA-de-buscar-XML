import Link from "next/link";
import { contexto } from "@/lib/sessao";
import { formatarIe } from "@/lib/documentos";
import { carregarMeis } from "@/lib/mei-dados";
import { FRACAO_COMPRAS, LIMITE_ANO, MESES_LONGOS, NIVEIS, mil, pct, reais } from "@/lib/mei";
import SeletorAno from "./SeletorAno";

export default async function MonitoramentoMei({ searchParams }: { searchParams: Promise<{ ano?: string; filtro?: string }> }) {
  const { supabase, admin } = await contexto();
  const atual = new Date().getFullYear();
  const sp = await searchParams;
  const pedido = Number(sp.ano);
  const ano = pedido >= 2018 && pedido <= atual ? pedido : atual;
  const { meis, erros } = await carregarMeis(supabase, ano);

  const conta = (...n: string[]) => meis.filter((m) => n.includes(m.ano.nivel)).length;
  const ultimo = Math.max(-1, ...meis.map((m) => m.ano.ultimo));
  // cada caixa é um filtro: clicar sobe os MEIs daquela situação; clicar de novo limpa
  const FILTROS: Record<string, string[]> = {
    dentro: ["ok"], perto: ["atencao", "ritmo"], passou: ["excedeu", "excedeu20"], sem: ["sem_dados"],
  };
  const filtro = sp.filtro && FILTROS[sp.filtro] ? sp.filtro : null;
  const noFiltro = (m: (typeof meis)[number]) => !!filtro && FILTROS[filtro].includes(m.ano.nivel);
  const posicao = new Map(meis.map((m, i) => [m, i + 1]));  // posição pelo faturamento, mesmo com filtro
  if (filtro) meis.sort((a, b) => Number(noFiltro(b)) - Number(noFiltro(a)));  // estável: dentro de cada grupo, maior faturamento primeiro
  const numeros = [
    { id: "sem", nome: "MEIs monitorados", valor: meis.length, sub: conta("sem_dados") ? `${conta("sem_dados")} sem consulta ainda` : "todos já consultados", classe: "" },
    { id: "dentro", nome: "Dentro do limite", valor: conta("ok"), sub: "abaixo de 80% e no ritmo", classe: "mei-ok" },
    { id: "perto", nome: "Perto do limite", valor: conta("atencao", "ritmo"), sub: "80% ou no ritmo de passar", classe: "mei-alerta" },
    { id: "passou", nome: "Passaram do limite", valor: conta("excedeu", "excedeu20"), sub: "faturamento ou compras", classe: "mei-erro" },
  ];
  const link = (f: string | null) => `/painel/mei?ano=${ano}${f ? `&filtro=${f}` : ""}`;
  // escala comum a todas as linhas: dá para comparar os MEIs entre si
  const fim = Math.max(LIMITE_ANO * 1.25, ...meis.map((m) => Math.max(m.ano.faturamento.total, m.ano.compras.total))) * 1.04;
  const x = (v: number) => `${(Math.max(v, 0) / fim) * 100}%`;
  const passo = fim > 200000 ? 50000 : 20000;
  const escala = Array.from({ length: Math.floor(fim / passo) + 1 }, (_, i) => i * passo);
  const referencias = [
    { v: LIMITE_ANO * FRACAO_COMPRAS, nome: "80% · limite de compras", classe: "ref-80" },
    { v: LIMITE_ANO, nome: "limite R$ 81 mil", classe: "ref-100" },
    { v: LIMITE_ANO * 1.2, nome: "+20%", classe: "ref-120" },
  ];

  return (
    <>
      <div className="cabeca-pagina">
        <div>
          <h1>Monitoramento de Faturamento MEI</h1>
          <p className="suave">
            {ultimo >= 0 ? `${ano}, de janeiro a ${MESES_LONGOS[ultimo]}.` : `${ano}.`} Limites no ano: R$ 81.000 de faturamento
            e R$ 64.800 de compras (proporcionais no ano de abertura).
          </p>
        </div>
        <SeletorAno ano={ano} atual={atual} />
      </div>

      {erros.length > 0 && (
        <div className="faixa erro">
          Parte dos dados não pôde ser lida. {admin ? `Rode de novo o schema.sql no Supabase (${erros[0]}).` : "Avise a LotiVisse."}
        </div>
      )}

      <div className="mei-numeros">
        {numeros.map((i) => {
          // "MEIs monitorados" filtra os que ainda não têm consulta; sem nenhum, só limpa o filtro
          const alvo = i.id === "sem" && !conta("sem_dados") ? null : i.id;
          const ativo = filtro === i.id;
          return (
            <Link key={i.id} href={link(ativo ? null : alvo)} scroll={false} aria-pressed={ativo}
              className={`numero-cartao numero-filtro ${i.classe} ${ativo ? "ativo" : ""}`}
              title={ativo ? "Limpar o filtro" : alvo ? `Mostrar primeiro: ${i.nome.toLowerCase()}` : "Mostrar todos"}>
              <span className="nome">{i.nome}{ativo && <span aria-hidden="true"> ✕</span>}</span>
              <span className="valor">{i.valor}</span><span className="suave">{i.sub}</span>
            </Link>
          );
        })}
      </div>

      <section className="cartao">
        <div className="cartao-topo">
          <h2 className="titulo-cartao">Faturamento acumulado no ano, do maior para o menor</h2>
          {filtro && (
            <span className="suave">
              {(() => { const n = meis.filter(noFiltro).length; return `${n} ${n === 1 ? "MEI" : "MEIs"} no topo · `; })()}
              <Link href={link(null)} scroll={false}>limpar filtro</Link>
            </span>
          )}
          <span className="legenda"><i className="s-fat" /> Faturamento <i className="s-comp" /> Compras</span>
        </div>
        {meis.length === 0 ? (
          <div className="vazio-mei">
            <p><b>Nenhum MEI acompanhado em {ano}.</b></p>
            <p className="suave">Marque a coluna “Dossiê MEI” na planilha das empresas MEI e agende a competência. Na primeira vez, o robô busca o ano desde janeiro.</p>
            <Link href="/painel/agendar" className="botao">Agendar competência</Link>
          </div>
        ) : (
          <div className="ranking" role="table" aria-label="MEIs por faturamento no ano">
            <div className="ranking-linha ranking-cabeca" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">MEI</span>
              <span role="columnheader" className="ranking-eixo">
                {escala.map((v) => <i key={v} style={{ left: x(v) }}>{mil(v)}</i>)}
              </span>
              <span role="columnheader" className="num">Faturamento</span>
              <span role="columnheader" className="num">Compras</span>
              <span role="columnheader">Situação</span>
            </div>
            {meis.map((m) => {
              const nivel = NIVEIS[m.ano.nivel];
              const f = m.ano.faturamento, c = m.ano.compras;
              return (
                <Link key={`${m.org}${m.ie}`} role="row" className={`ranking-linha ${filtro ? (noFiltro(m) ? "linha-filtrada" : "linha-apagada") : ""}`}
                  href={`/painel/mei/${m.ie}?ano=${ano}${admin ? `&org=${m.org}` : ""}`}>
                  <span role="cell" className="ranking-pos">{posicao.get(m)}</span>
                  <span role="cell" className="ranking-nome">
                    <b>{m.nome || "MEI"}</b>
                    <span className="suave">IE {formatarIe(m.ie)}{m.ano.primeiroMes > 0 ? ` · abriu em ${MESES_LONGOS[m.ano.primeiroMes]}` : ""}</span>
                  </span>
                  <span role="cell" className="ranking-barras" aria-label={`Faturamento ${reais(f.total)}, compras ${reais(c.total)}`}>
                    {referencias.map((r) => <i key={r.classe} className={`ranking-ref ${r.classe}`} style={{ left: x(r.v) }} />)}
                    {f.limite !== LIMITE_ANO && <i className="ranking-ref ref-proprio" style={{ left: x(f.limite) }} title={`Limite proporcional: ${reais(f.limite, 0)}`} />}
                    <span className="ranking-barra s-fat" style={{ width: x(f.total) }} />
                    <span className="ranking-barra s-comp" style={{ width: x(c.total) }} />
                  </span>
                  <span role="cell" className="num"><b>{reais(f.total, 0)}</b><span className="suave">{pct(f.pct)} do limite</span></span>
                  <span role="cell" className="num"><b>{reais(c.total, 0)}</b><span className="suave">{pct(c.pct)} do limite</span></span>
                  <span role="cell"><span className={`status ${nivel.classe}`}><span aria-hidden="true">{nivel.sinal}</span> {nivel.nome}</span></span>
                </Link>
              );
            })}
            <div className="ranking-legenda suave">
              {referencias.map((r) => <span key={r.classe}><i className={`ranking-ref-leg ${r.classe}`} /> {r.nome}</span>)}
              <span><i className="ranking-ref-leg ref-proprio" /> limite proporcional (ano de abertura)</span>
            </div>
          </div>
        )}
      </section>
      <p className="suave nota-rodape">
        Faturamento do mês: o maior valor entre as notas de saída e as vendas no cartão (o cartão pode estar dentro das notas ou não),
        mais as receitas lançadas manualmente. Compras: notas de entrada mais as compras lançadas manualmente. Fonte: Dossiê do
        contribuinte no ATF da SEFAZ-PB.
      </p>
    </>
  );
}
