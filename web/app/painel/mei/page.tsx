import Link from "next/link";
import Icone from "@/components/Icones";
import { contexto } from "@/lib/sessao";
import { formatarIe } from "@/lib/documentos";
import { carregarMeis } from "@/lib/mei-dados";
import { MESES_LONGOS, NIVEIS, type Medida, pct, reais } from "@/lib/mei";
import SeletorAno from "./SeletorAno";

const ESCALA = 1.3;

function Regua({ titulo, medida, serie }: { titulo: string; medida: Medida; serie: "fat" | "comp" }) {
  const x = (v: number) => `${Math.min(v / (medida.limite * ESCALA), 1) * 100}%`;
  return (
    <div className="regua-linha">
      <span className="regua-titulo">{titulo}</span>
      <div className="regua-trilho" role="img" aria-label={`${titulo}: ${reais(medida.total)}, ${pct(medida.pct)} do limite`}>
        <span className={`regua-barra s-${serie}`} style={{ width: x(medida.total) }} />
        {[0.8, 1, 1.2].map((p) => <span key={p} className={`regua-marca ${p === 1 ? "limite" : ""}`} style={{ left: x(medida.limite * p) }} />)}
        {medida.esperado > 0 && <span className="regua-esperado" style={{ left: x(medida.esperado) }} />}
      </div>
      <span className="regua-numero"><b>{pct(medida.pct)}</b> <span className="suave">{reais(medida.total, 0)}</span></span>
    </div>
  );
}

export default async function MonitoramentoMei({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const { supabase, admin } = await contexto();
  const atual = new Date().getFullYear();
  const pedido = Number((await searchParams).ano);
  const ano = pedido >= 2018 && pedido <= atual ? pedido : atual;
  const meis = await carregarMeis(supabase, ano);

  const conta = (...n: string[]) => meis.filter((m) => n.includes(m.ano.nivel)).length;
  const ultimo = Math.max(-1, ...meis.map((m) => m.ano.ultimo));
  const alertas = meis.filter((m) => ["excedeu20", "excedeu", "atencao", "ritmo"].includes(m.ano.nivel));
  const numeros = [
    { nome: "MEIs monitorados", valor: meis.length, sub: "marcados como MEI na planilha", classe: "" },
    { nome: "Dentro do limite", valor: conta("ok"), sub: "abaixo de 80% e no ritmo", classe: "mei-ok" },
    { nome: "Perto do limite", valor: conta("atencao", "ritmo"), sub: "80% ou no ritmo de passar", classe: "mei-alerta" },
    { nome: "Passaram do limite", valor: conta("excedeu", "excedeu20"), sub: "faturamento ou compras", classe: "mei-erro" },
  ];

  return (
    <>
      <div className="cabeca-pagina">
        <div>
          <h1>Monitoramento de Faturamento MEI</h1>
          <p className="suave">
            {ultimo >= 0 ? `${ano}, de janeiro a ${MESES_LONGOS[ultimo]}.` : `${ano}.`} Limite de R$ 81.000 de faturamento
            e R$ 64.800 de compras no ano, proporcional no ano de abertura.
          </p>
        </div>
        <SeletorAno ano={ano} atual={atual} />
      </div>

      <div className="mei-numeros">
        {numeros.map((i) => (
          <div key={i.nome} className={`numero-cartao ${i.classe}`}>
            <span className="nome">{i.nome}</span><span className="valor">{i.valor}</span><span className="suave">{i.sub}</span>
          </div>
        ))}
      </div>

      {alertas.length > 0 && (
        <div className="faixa alerta">
          <b>{alertas.length === 1 ? "1 MEI precisa" : `${alertas.length} MEIs precisam`} de atenção:</b>{" "}
          {alertas.map((m) => `${m.nome} (${pct(Math.max(m.ano.faturamento.pct, m.ano.compras.pct))})`).join(", ")}.
        </div>
      )}

      <section className="cartao">
        <div className="cartao-topo">
          <h2 className="titulo-cartao">Quanto cada MEI já usou do limite</h2>
          <span className="legenda"><i className="s-fat" /> Faturamento <i className="s-comp" /> Compras <i className="esperado" /> média esperada até o mês</span>
        </div>
        {meis.length === 0 ? (
          <div className="vazio-mei">
            <p><b>Nenhum MEI acompanhado em {ano}.</b></p>
            <p className="suave">Marque a coluna “Dossiê MEI” na planilha das empresas MEI e agende a competência. Na primeira vez o robô busca o ano desde janeiro.</p>
            <Link href="/painel/agendar" className="botao">Agendar competência</Link>
          </div>
        ) : (
          <ul className="mei-lista">
            {meis.map((m) => {
              const nivel = NIVEIS[m.ano.nivel];
              return (
                <li key={`${m.org}${m.ie}`}>
                  <Link href={`/painel/mei/${m.ie}?ano=${ano}${admin ? `&org=${m.org}` : ""}`} className="mei-item">
                    <div className="mei-item-topo">
                      <span className="mei-nome"><b>{m.nome || "MEI"}</b> <span className="suave">IE {formatarIe(m.ie)}</span></span>
                      <span className={`status ${nivel.classe}`}><span aria-hidden="true">{nivel.sinal}</span> {nivel.nome}</span>
                    </div>
                    {m.ano.nivel === "sem_dados" ? (
                      <p className="suave mei-sem-dados">Aguardando a primeira consulta do Dossiê MEI.</p>
                    ) : (
                      <div className="reguas">
                        <Regua titulo="Faturamento" medida={m.ano.faturamento} serie="fat" />
                        <Regua titulo="Compras" medida={m.ano.compras} serie="comp" />
                      </div>
                    )}
                    <div className="mei-item-rodape suave">
                      {m.ano.primeiroMes > 0 && <span>Abriu em {MESES_LONGOS[m.ano.primeiroMes]}: limite proporcional</span>}
                      {m.ano.mesesAcima > 0 && <span className="mei-acima">{m.ano.mesesAcima} {m.ano.mesesAcima > 1 ? "meses" : "mês"} acima de R$ 6.750</span>}
                      {(m.ano.receitaManual !== 0 || m.ano.compraManual !== 0) && <span>com lançamentos manuais</span>}
                      <span className="mei-ver">Ver painel <Icone nome="seta" tamanho={16} /></span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="suave nota-rodape">
        Faturamento do mês: o maior valor entre as notas de saída e as vendas no cartão (o cartão pode estar ou não dentro das notas),
        mais as receitas lançadas à mão. Compras: notas de entrada mais as compras lançadas à mão. Fonte: Dossiê do contribuinte no ATF da SEFAZ-PB.
      </p>
    </>
  );
}
