import { NIVEIS, type Medida, pct, reais } from "@/lib/mei";

const ESCALA = 1.3; // o arco vai até 130% do limite: dá para ver quanto passou

/** Velocímetro de meia-volta: quanto do limite já foi usado (marcas em 80%, 100% e 120%). */
export default function Medidor({ titulo, medida, serie }: { titulo: string; medida: Medida; serie: "fat" | "comp" }) {
  const R = 80, cx = 100, cy = 96;
  const ponto = (f: number) => {
    const a = Math.PI * (1 - Math.min(Math.max(f, 0), 1));
    return [cx + R * Math.cos(a), cy - R * Math.sin(a)];
  };
  const arco = (de: number, ate: number) => {
    const [x1, y1] = ponto(de), [x2, y2] = ponto(ate);
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  };
  const f = Math.min(medida.pct / ESCALA, 1);
  const nivel = NIVEIS[medida.nivel];
  const giro = -90 + 180 * f;
  return (
    <div className={`medidor medidor-${serie}`}>
      <div className="medidor-topo">
        <span className="nome">{titulo}</span>
        <span className="suave">Limite {reais(medida.limite, 0)}</span>
      </div>
      <svg viewBox="0 0 200 112" role="img" aria-label={`${titulo}: ${pct(medida.pct)} do limite de ${reais(medida.limite, 0)}`}>
        <path d={arco(0, 1)} className="medidor-trilho" />
        <path d={arco(0.8 / ESCALA, 1 / ESCALA)} className="medidor-faixa atencao" />
        <path d={arco(1 / ESCALA, 1)} className="medidor-faixa excesso" />
        {f > 0.002 && <path d={arco(0, f)} className="medidor-valor" pathLength={1} />}
        {[0.8, 1, 1.2].map((p) => {
          const [x1, y1] = ponto(p / ESCALA);
          const [x2, y2] = [cx + (x1 - cx) * 1.16, cy + (y1 - cy) * 1.16];
          return <g key={p}><line x1={x1} y1={y1} x2={x2} y2={y2} className="medidor-marca" />
            <text x={cx + (x1 - cx) * 1.3} y={cy + (y1 - cy) * 1.3 + 3} textAnchor="middle" className="medidor-rotulo">{p * 100}%</text></g>;
        })}
        <g className="medidor-ponteiro" style={{ ["--giro" as string]: `${giro}deg` }}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - R + 14} />
          <circle cx={cx} cy={cy} r="5" />
        </g>
      </svg>
      <div className="medidor-valor-texto">
        <b>{reais(medida.total)}</b>
        <span className={`status ${nivel.classe}`}><span aria-hidden="true">{nivel.sinal}</span> {pct(medida.pct)} · {nivel.nome}</span>
      </div>
    </div>
  );
}
