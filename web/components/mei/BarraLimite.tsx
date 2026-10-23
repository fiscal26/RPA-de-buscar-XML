import { NIVEIS, type Medida, mil, pct, reais } from "@/lib/mei";

const ESCALA = 1.3; // a régua vai até 130% do limite: dá para ver quanto passou

/**
 * Régua horizontal do limite: faixas de 80% (atenção), 100% (limite) e 120% (excesso que retroage),
 * barra do acumulado, marca da média esperada até o mês e a escala em reais embaixo.
 */
export default function BarraLimite({ titulo, medida, serie, detalhe }: {
  titulo: string; medida: Medida; serie: "fat" | "comp"; detalhe?: string;
}) {
  const fim = medida.limite * ESCALA;
  const x = (v: number) => `${(Math.min(Math.max(v, 0), fim) / fim) * 100}%`;
  const nivel = NIVEIS[medida.nivel];
  const marcas = [0, 0.25, 0.5, 0.8, 1, 1.2];
  return (
    <div className="barra-limite">
      <div className="barra-limite-topo">
        <span className="nome">{titulo}</span>
        <span className="barra-limite-valor"><b>{reais(medida.total)}</b> <span className="suave">de {reais(medida.limite, 0)}</span></span>
        <span className={`status ${nivel.classe}`}><span aria-hidden="true">{nivel.sinal}</span> {pct(medida.pct)} · {nivel.nome}</span>
      </div>
      <div className="barra-limite-trilho" role="img"
        aria-label={`${titulo}: ${reais(medida.total)}, ${pct(medida.pct)} do limite de ${reais(medida.limite, 0)}`}>
        <span className="faixa-80" style={{ left: x(medida.limite * 0.8), width: `calc(${x(medida.limite)} - ${x(medida.limite * 0.8)})` }} />
        <span className="faixa-100" style={{ left: x(medida.limite), width: `calc(${x(medida.limite * 1.2)} - ${x(medida.limite)})` }} />
        <span className="faixa-120" style={{ left: x(medida.limite * 1.2), right: 0 }} />
        <span className={`barra-limite-preenchido s-${serie}`} style={{ width: x(medida.total) }} />
        {medida.esperado > 0 && <span className="barra-limite-esperado" style={{ left: x(medida.esperado) }} title="Média esperada até o último mês consultado" />}
        <span className="barra-limite-linha" style={{ left: x(medida.limite) }} />
      </div>
      <div className="barra-limite-escala" aria-hidden="true">
        {marcas.map((m) => (
          <span key={m} style={{ left: x(medida.limite * m) }} className={m === 1 ? "limite" : ""}>
            {m === 0 ? "0" : m === 1 ? `limite ${mil(medida.limite)}` : m === 1.2 ? "+20%" : `${Math.round(m * 100)}%`}
          </span>
        ))}
      </div>
      {detalhe && <p className="suave barra-limite-detalhe">{detalhe}</p>}
    </div>
  );
}
