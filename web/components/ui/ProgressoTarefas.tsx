"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export default function ProgressoTarefas({ feitas, total, abertas, erros, children }: {
  feitas: number; total: number; abertas: number; erros: number; children: ReactNode;
}) {
  const anteriores = useRef(abertas);
  const [anuncio, setAnuncio] = useState("");
  const pct = total ? Math.round(feitas / total * 100) : 0;
  useEffect(() => {
    if (anteriores.current > 0 && abertas === 0) setAnuncio(`Processamento encerrado. ${feitas} tarefas processadas; ${erros} com erro.`);
    anteriores.current = abertas;
  }, [abertas, feitas, erros]);
  return <section className="cartao progresso">
    <div className="progresso-topo"><h2 className="titulo-cartao">Progresso da execução</h2><span className="progresso-pct">{pct}%</span></div>
    <progress className="progresso-nativo" max={Math.max(total, 1)} value={feitas}
      aria-label="Tarefas processadas" aria-valuetext={`${feitas} de ${total} processadas; ${abertas} em aberto; ${erros} com erro`} />
    <div className="progresso-rodape"><span>{feitas} de {total} tarefas processadas</span><span>{abertas ? `${abertas} em aberto` : total ? "Processamento encerrado" : "Nenhuma tarefa"}</span></div>
    <p className="progresso-explicacao suave">Processadas incluem os resultados com erro. Confira as pendências antes de encerrar a competência.</p>
    {children}<span className="sr" role="status">{anuncio}</span>
  </section>;
}
