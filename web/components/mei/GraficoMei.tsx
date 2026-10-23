"use client";

import { useState } from "react";
import { FRACAO_COMPRAS, LIMITE_MES, MESES, MESES_LONGOS, type Mes, mil, reais } from "@/lib/mei";

type Props = {
  meses: Mes[]; ultimo: number; primeiroMes: number;
  limiteFat: number; limiteCompras: number; projecaoFat: number; projecaoCompras: number;
};

const W = 720, H = 300, E = 52, D = 14, T = 16, B = 26;

/** Gráfico do ano: mês a mês (barras) ou acumulado (linhas contra os limites). Passe o mouse para ver o mês. */
export default function GraficoMei(p: Props) {
  const [vista, setVista] = useState<"mes" | "acum">("mes");
  const [mostrar, setMostrar] = useState({ fat: true, comp: true });
  const [foco, setFoco] = useState<number | null>(null);

  const largura = (W - E - D) / 12;
  const cx = (i: number) => E + largura * i + largura / 2;
  const valores = p.meses.filter((m) => m.mes <= p.ultimo);
  const max = vista === "mes"
    ? Math.max(LIMITE_MES * 1.25, ...valores.map((m) => Math.max(mostrar.fat ? m.faturamento : 0, mostrar.comp ? m.compras : 0))) * 1.08
    : Math.max(p.limiteFat * 1.25, mostrar.fat ? p.projecaoFat : 0, mostrar.comp ? p.projecaoCompras : 0) * 1.05;
  const y = (v: number) => T + (H - T - B) * (1 - Math.max(v, 0) / max);
  const passo = [1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000].find((s) => max / s <= 5) ?? 50000;
  const grade = Array.from({ length: Math.floor(max / passo) + 1 }, (_, i) => i * passo);
  const caminho = (k: "faturamentoAcum" | "comprasAcum") =>
    valores.filter((m) => m.ativo).map((m, i) => `${i ? "L" : "M"}${cx(m.mes)},${y(m[k])}`).join(" ");
  // liga/desliga uma série; pelo menos uma fica visível
  const so = (serie: "fat" | "comp") => setMostrar((s) => {
    const novo = { ...s, [serie]: !s[serie] };
    return novo.fat || novo.comp ? novo : s;
  });
  const m = foco === null ? null : p.meses[foco];
  const bw = Math.min(16, largura / 3);

  return (
    <div className="grafico-mei">
      <div className="grafico-controles">
        <div className="alternar" role="tablist" aria-label="Vista">
          <button type="button" role="tab" aria-selected={vista === "mes"} onClick={() => setVista("mes")}>Mês a mês</button>
          <button type="button" role="tab" aria-selected={vista === "acum"} onClick={() => setVista("acum")}>Acumulado no ano</button>
        </div>
        <div className="series">
          <button type="button" className="serie-botao s-fat" aria-pressed={mostrar.fat} onClick={() => so("fat")}><i /> Faturamento</button>
          <button type="button" className="serie-botao s-comp" aria-pressed={mostrar.comp} onClick={() => so("comp")}><i /> Compras</button>
        </div>
      </div>

      <div className="grafico-area" onMouseLeave={() => setFoco(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={vista === "mes" ? "Faturamento e compras por mês" : "Faturamento e compras acumulados no ano"}>
          {grade.map((v) => (
            <g key={v}>
              <line x1={E} x2={W - D} y1={y(v)} y2={y(v)} className="grade" />
              <text x={E - 8} y={y(v) + 4} textAnchor="end" className="eixo">{mil(v)}</text>
            </g>
          ))}
          {MESES.map((nome, i) => <text key={nome} x={cx(i)} y={H - 8} textAnchor="middle" className={`eixo ${foco === i ? "forte" : ""}`}>{nome}</text>)}
          {foco !== null && <rect x={E + largura * foco} y={T} width={largura} height={H - T - B} className="coluna-foco" />}

          {vista === "mes" ? (
            <>
              {mostrar.fat && <Referencia y={y(LIMITE_MES)} texto={`${reais(LIMITE_MES, 0)} de faturamento/mês`} classe="ref-fat" />}
              {mostrar.comp && <Referencia y={y(LIMITE_MES * FRACAO_COMPRAS)} texto={`${reais(LIMITE_MES * FRACAO_COMPRAS, 0)} de compras/mês`} classe="ref-comp" abaixo />}
              {valores.map((mm) => {
                const lado = mostrar.fat && mostrar.comp;
                return (
                  <g key={mm.mes} className="barras-mes">
                    {mostrar.fat && <Barra x={cx(mm.mes) - (lado ? bw + 1 : bw / 2)} largura={bw} topo={y(mm.faturamento)} base={y(0)} classe={`b-fat ${mm.acimaFaturamento ? "acima" : ""}`} />}
                    {mostrar.comp && <Barra x={cx(mm.mes) + (lado ? 1 : -bw / 2)} largura={bw} topo={y(mm.compras)} base={y(0)} classe={`b-comp ${mm.acimaCompras ? "acima" : ""}`} />}
                    {mm.semMovimento && <text x={cx(mm.mes)} y={y(0) - 6} textAnchor="middle" className="eixo">s/ mov.</text>}
                  </g>
                );
              })}
            </>
          ) : (
            <>
              {mostrar.fat && <Referencia y={y(p.limiteFat)} texto={`Limite de faturamento ${reais(p.limiteFat, 0)}`} classe="ref-fat" />}
              {mostrar.fat && <Referencia y={y(p.limiteFat * 1.2)} texto="+20%" classe="ref-fat fraca" />}
              {mostrar.comp && <Referencia y={y(p.limiteCompras)} texto={`Limite de compras ${reais(p.limiteCompras, 0)}`} classe="ref-comp" abaixo />}
              {p.ultimo >= 0 && p.ultimo < 11 && mostrar.fat && (
                <line x1={cx(p.ultimo)} y1={y(p.meses[p.ultimo].faturamentoAcum)} x2={cx(11)} y2={y(p.projecaoFat)} className="projecao s-fat" />
              )}
              {p.ultimo >= 0 && p.ultimo < 11 && mostrar.comp && (
                <line x1={cx(p.ultimo)} y1={y(p.meses[p.ultimo].comprasAcum)} x2={cx(11)} y2={y(p.projecaoCompras)} className="projecao s-comp" />
              )}
              {mostrar.comp && <path d={caminho("comprasAcum")} className="linha s-comp" />}
              {mostrar.fat && <path d={caminho("faturamentoAcum")} className="linha s-fat" />}
              {valores.filter((mm) => mm.ativo).map((mm) => (
                <g key={mm.mes}>
                  {mostrar.comp && <circle cx={cx(mm.mes)} cy={y(mm.comprasAcum)} r={foco === mm.mes ? 5 : 3.5} className="ponto s-comp" />}
                  {mostrar.fat && <circle cx={cx(mm.mes)} cy={y(mm.faturamentoAcum)} r={foco === mm.mes ? 5 : 3.5} className="ponto s-fat" />}
                </g>
              ))}
              {p.ultimo >= 0 && p.ultimo < 11 && (mostrar.fat || mostrar.comp) && (
                <text x={cx(11)} y={y(mostrar.fat ? p.projecaoFat : p.projecaoCompras) - 8} textAnchor="end" className="eixo">projeção em dezembro</text>
              )}
            </>
          )}

          {MESES.map((_, i) => (
            <rect key={i} x={E + largura * i} y={0} width={largura} height={H} fill="transparent"
              onMouseEnter={() => setFoco(i)} onClick={() => setFoco(i)} />
          ))}
        </svg>

        {m && (
          <div className={`dica ${m.mes > 7 ? "esquerda" : ""}`} style={{ left: `${(cx(m.mes) / W) * 100}%` }} role="status">
            <b>{MESES_LONGOS[m.mes]}</b>
            {!m.ativo ? <span className="suave">antes do início da atividade</span>
              : !m.consultado && !m.receitaManual && !m.compraManual ? <span className="suave">ainda não consultado</span> : (
              <dl>
                <dt><i className="s-fat" /> Faturamento</dt><dd>{reais(vista === "mes" ? m.faturamento : m.faturamentoAcum)}</dd>
                {vista === "mes" && <>
                  <dt className="sub">notas</dt><dd className="sub">{reais(m.notas)}</dd>
                  <dt className="sub">cartão</dt><dd className="sub">{reais(m.cartao)}</dd>
                  {!!m.receitaManual && <><dt className="sub">manual</dt><dd className="sub">{reais(m.receitaManual)}</dd></>}
                </>}
                <dt><i className="s-comp" /> Compras</dt><dd>{reais(vista === "mes" ? m.compras : m.comprasAcum)}</dd>
                {vista === "mes" && !!m.compraManual && <><dt className="sub">manual</dt><dd className="sub">{reais(m.compraManual)}</dd></>}
                {vista === "mes" && m.acimaFaturamento && <dd className="dica-alerta">Faturamento acima de {reais(LIMITE_MES, 0)} no mês</dd>}
                {vista === "mes" && m.acimaCompras && <dd className="dica-alerta">Compras acima de {reais(LIMITE_MES * FRACAO_COMPRAS, 0)} no mês</dd>}
              </dl>
            )}
          </div>
        )}
      </div>
      <p className="suave grafico-nota">
        {vista === "mes"
          ? "Barra em destaque: mês acima da média do limite (R$ 6.750 de faturamento ou R$ 5.400 de compras)."
          : "Linha tracejada: projeção até dezembro, mantida a média mensal."}
      </p>
    </div>
  );
}

function Barra({ x, largura, topo, base, classe }: { x: number; largura: number; topo: number; base: number; classe: string }) {
  const h = Math.max(base - topo, 0);
  if (h < 0.5) return null;
  const r = Math.min(4, h, largura / 2);
  // canto arredondado só no topo; a base encosta no eixo
  return <path className={`barra ${classe}`} d={`M${x},${base} V${topo + r} Q${x},${topo} ${x + r},${topo} H${x + largura - r} Q${x + largura},${topo} ${x + largura},${topo + r} V${base} Z`} />;
}

function Referencia({ y, texto, classe, abaixo }: { y: number; texto: string; classe: string; abaixo?: boolean }) {
  return (
    <g className={`referencia ${classe}`}>
      <line x1={E} x2={W - D} y1={y} y2={y} />
      <text x={W - D} y={abaixo ? y + 14 : y - 6} textAnchor="end">{texto}</text>
    </g>
  );
}
