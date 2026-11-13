import Icone from "@/components/Icones";
import Link from "next/link";
import { notFound } from "next/navigation";
import { contexto } from "@/lib/sessao";
import { dataBR, dataHoraBR, formatarIe, formatarDocumento, competenciaBR } from "@/lib/documentos";
import { carregarMeis } from "@/lib/mei-dados";
import { MESES, MESES_LONGOS, NIVEIS, explicacao, pct, reais } from "@/lib/mei";
import BarraLimite from "@/components/mei/BarraLimite";
import GraficoMei from "@/components/mei/GraficoMei";
import SeletorAno from "../SeletorAno";
import FormAjuste from "./FormAjuste";
import { naoEhMei, removerAjuste } from "../actions";
import BotaoNaoMei from "./BotaoNaoMei";
import FormReprocessar from "../FormReprocessar";

export default async function PainelMei({ params, searchParams }: {
  params: Promise<{ ie: string }>; searchParams: Promise<{ ano?: string; org?: string }>;
}) {
  const { ie } = await params;
  const sp = await searchParams;
  if (!/^(\d{9}|\d{14})$/.test(ie)) notFound();
  const { supabase, perfil, admin } = await contexto();
  const gerencia = admin || perfil.papel === "gestor";
  const atual = new Date().getFullYear();
  const ano = Number(sp.ano) >= 2018 && Number(sp.ano) <= atual ? Number(sp.ano) : atual;
  const { meis: lista } = await carregarMeis(supabase, ano, ie);
  const mei = lista.find((m) => m.org === sp.org) ?? lista[0];
  if (!mei) notFound();
  const a = mei.ano;
  const nivel = NIVEIS[a.nivel];
  const classeFaixa = a.conferirFontes ? "alerta" : nivel.classe === "st-erro" ? "erro" : nivel.classe === "st-alerta" ? "alerta" : "ok";
  const consultado = mei.meses.map((m) => m.consultado_em).filter(Boolean).sort().at(-1);
  const docs = new Map<string, { entradas: number; saidas: number; qtdE: number; qtdS: number }>();
  for (const m of mei.meses) for (const i of m.itens ?? []) {
    const d = docs.get(i.tipo) ?? { entradas: 0, saidas: 0, qtdE: 0, qtdS: 0 };
    d.entradas += Number(i.entradas) || 0; d.saidas += Number(i.saidas) || 0;
    d.qtdE += Number(i.qtd_entradas) || 0; d.qtdS += Number(i.qtd_saidas) || 0;
    docs.set(i.tipo, d);
  }
  const mesesVisiveis = a.meses.filter((m) => m.ativo && m.mes <= Math.max(a.ultimo, 0));

  return (
    <>
      <p className="voltar"><Link href={`/painel/mei?ano=${ano}`}>Monitoramento MEI</Link></p>
      <div className="cabeca-pagina">
        <div>
          <h1>{mei.nome || "MEI"}</h1>
          <p className="suave">
            {mei.cnpj ? `CNPJ ${formatarDocumento(mei.cnpj)}` : `IE ${formatarIe(mei.ie)}`}
            {a.inicio && ` · início da atividade em ${dataBR(a.inicio)}`}
            {a.simei && " · optante pelo SIMEI"}
            {consultado && ` · dados atualizados em ${dataHoraBR(consultado)}`}
            {mei.cadastro && ` · MEI desde ${competenciaBR(mei.cadastro.inicio_mei)}${mei.cadastro.fim_mei ? ` até ${competenciaBR(mei.cadastro.fim_mei)}` : ""}`}
          </p>
        </div>
        <div className="acoes-cabeca">
          <SeletorAno ano={ano} atual={atual} />
          {gerencia && (
            <form action={naoEhMei}>
              <input type="hidden" name="ie" value={mei.ie} />
              <input type="hidden" name="org" value={mei.org} />
              <BotaoNaoMei nome={mei.nome || "Esta empresa"} />
            </form>
          )}
        </div>
      </div>

      {a.conferirFontes && <p className="faixa alerta">Há resumo antigo do ATF sem os tipos de documento.
        Até reprocessar o Dossiê MEI, usamos o maior valor entre esse resumo e as NFS-e, sem presumir que podem ser somados.
        O total é provisório e os alertas automáticos ficam suspensos para evitar duplicidade.</p>}

      {gerencia && <section className="cartao">
        <h2 className="titulo-cartao">Atualizar faturamento</h2>
        <FormReprocessar org={mei.org} documento={mei.ie} competencia={`${ano}-${String(Math.max(a.ultimo, a.primeiroMes) + 1).padStart(2, "0")}`} />
        <Link href="/painel/empresas#cadastro-mei" className="link-discreto">Editar enquadramento MEI</Link>
      </section>}

      <div className={`faixa ${classeFaixa} faixa-mei`}>
        <span className={`status ${a.conferirFontes ? "st-alerta" : nivel.classe}`}><span aria-hidden="true">{nivel.sinal}</span> {a.conferirFontes ? "Conferir fontes" : nivel.nome}</span>
        <span>{a.conferirFontes ? "Total provisório: reprocese o Dossiê MEI para conferir a composição do faturamento." : explicacao(a)}</span>
      </div>

      <div className="mei-topo">
        <section className="cartao mei-barras">
          <h2 className="titulo-cartao">Uso do limite no ano</h2>
          {a.compras.nivel === "sem_dados" && <p className="suave">Compras: sem consulta ao ATF ou lançamento manual no período. NFS-e recebidas não são incluídas como compras.</p>}
          <BarraLimite titulo="Faturamento" medida={a.faturamento} serie="fat"
            detalhe={a.decorridos ? `Projeção para dezembro: ${reais(a.faturamento.projecao, 0)} (${pct(a.faturamento.projecao / a.faturamento.limite)} do limite).` : undefined} />
          <BarraLimite titulo="Compras" medida={a.compras} serie="comp"
            detalhe={a.decorridos && a.compras.nivel !== "sem_dados" ? `Projeção para dezembro: ${reais(a.compras.projecao, 0)} (${pct(a.compras.projecao / a.compras.limite)} do limite).` : undefined} />
          <p className="suave legenda-barra"><i className="esperado" /> média esperada até o último mês consultado
            {mei.meses.some((m) => m.origem === "execucao") && " · alguns meses vieram só do resumo da execução (sem detalhe por documento)"}</p>
        </section>
        <section className="cartao mei-resumo">
          <h2 className="titulo-cartao">No ano</h2>
          <dl>
            <dt>Notas de saída</dt><dd>{reais(a.notas)}</dd>
            <dt>NFS-e emitidas</dt><dd>{reais(a.nfse)}</dd>
            <dt>Vendas no cartão</dt><dd>{reais(a.cartao)}</dd>
            <dt>Receitas manuais</dt><dd>{reais(a.receitaManual)}</dd>
            <dt>Notas de entrada</dt><dd>{reais(a.entradas)}</dd>
            <dt>Compras manuais</dt><dd>{reais(a.compraManual)}</dd>
            <dt>Disponível no ano</dt>
            <dd className={a.faturamento.limite - a.faturamento.total < 0 ? "negativo" : ""}>{reais(a.faturamento.limite - a.faturamento.total, 0)}</dd>
          </dl>
        </section>
      </div>

      <section className="cartao">
        <div className="cartao-topo">
          <h2 className="titulo-cartao">Mês a mês</h2>
          <span className="suave">Passe o mouse (ou toque) num mês para ver o detalhe.</span>
        </div>
        <GraficoMei meses={a.meses} ultimo={a.ultimo} primeiroMes={a.primeiroMes}
          limiteFat={a.faturamento.limite} limiteCompras={a.compras.limite}
          projecaoFat={a.faturamento.projecao} projecaoCompras={a.compras.projecao} />
        {mesesVisiveis.length > 0 && (
          <details className="detalhe-tabela">
            <summary>Ver a tabela do ano</summary>
            <div className="tabela-rolagem">
              <table className="tabela-mei">
                <thead>
                  <tr><th>Mês / fontes</th><th>Notas de saída ATF</th><th>NFS-e emitidas</th><th>Cartão</th><th>Receita manual</th><th>Faturamento</th><th>Acumulado</th>
                    <th>Notas de entrada</th><th>Compra manual</th><th>Compras</th><th>Acumulado</th></tr>
                </thead>
                <tbody>
                  {mesesVisiveis.map((m) => (
                    <tr key={m.mes}>
                      <td>{MESES[m.mes]}{m.semMovimento && <span className="status st-neutro" style={{ marginLeft: 6 }}>sem movimento</span>}
                        {!m.consultado && <span className="status st-neutro" style={{ marginLeft: 6 }}>não consultado</span>}
                        <small className="suave">{m.consultadoAtf ? " · ATF consultado" : " · ATF sem consulta"}{m.consultadoNfse ? " · NFS-e consultada" : " · NFS-e sem consulta"}</small></td>
                      <td>{m.consultadoAtf ? reais(m.notas) : "—"}</td><td>{m.consultadoNfse ? reais(m.nfse) : "—"}</td><td>{reais(m.cartao)}</td><td>{m.receitaManual ? reais(m.receitaManual) : "—"}</td>
                      <td className={m.acimaFaturamento ? "valor-acima" : ""}><b>{reais(m.faturamento)}</b></td><td>{reais(m.faturamentoAcum)}</td>
                      <td>{reais(m.entradas)}</td><td>{m.compraManual ? reais(m.compraManual) : "—"}</td>
                      <td className={m.acimaCompras ? "valor-acima" : ""}><b>{reais(m.compras)}</b></td><td>{reais(m.comprasAcum)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {docs.size > 0 && (
              <>
                <h3 className="mei-sub">Por tipo de documento (Docs fiscais do ATF)</h3>
                <div className="tabela-rolagem">
                  <table>
                    <thead><tr><th>Documento</th><th>Qtd. entradas</th><th>Entradas</th><th>Qtd. saídas</th><th>Saídas</th></tr></thead>
                    <tbody>
                      {[...docs].map(([tipo, d]) => (
                        <tr key={tipo}><td>{tipo}</td><td>{d.qtdE}</td><td>{reais(d.entradas)}</td><td>{d.qtdS}</td><td>{reais(d.saidas)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </details>
        )}
      </section>

      <section className="cartao">
        <h2 className="titulo-cartao">Lançamentos manuais</h2>
        <p className="suave">
          Para receitas e compras que não aparecem nas consultas: vendas sem nota para pessoa física, serviços sem NFS-e, compras em outro estado.
          Use valor negativo para corrigir para menos. Entram no faturamento ou nas compras do mês.
        </p>
        <FormAjuste org={mei.org} ie={mei.ie} ano={ano} mesPadrao={Math.max(a.ultimo, a.primeiroMes)} />
        {mei.ajustes.length > 0 && (
          <ul className="ajustes-lista">
            {mei.ajustes.map((j) => (
              <li key={j.id}>
                <span className={`status ${j.tipo === "receita" ? "st-fila" : "st-neutro"}`}>{j.tipo === "receita" ? "Receita" : "Compra"}</span>
                <span className="ajuste-texto"><b>{j.descricao}</b>
                  <span className="suave">{MESES_LONGOS[Number(j.competencia.slice(5, 7)) - 1]} · incluído em {dataHoraBR(j.criado_em)}</span></span>
                <b className={j.valor < 0 ? "negativo" : ""}>{reais(j.valor)}</b>
                <form action={removerAjuste}>
                  <input type="hidden" name="id" value={j.id} />
                  <button type="submit" className="perigo botao-icone" aria-label={`Excluir ${j.descricao}`} data-dica="Excluir">
                    <Icone nome="lixeira" tamanho={18} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="suave nota-rodape">
        Limites: R$ 81.000 de faturamento no ano (R$ 6.750 por mês de atividade no ano de abertura) e compras até 80% desse valor.
        Passar até 20% do limite desenquadra no ano seguinte; acima de 20%, desde o início do ano. Percentual atual do faturamento: {pct(a.faturamento.pct)}.
      </p>
    </>
  );
}
