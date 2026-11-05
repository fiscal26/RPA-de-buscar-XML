"use client";

import { useEffect, useState } from "react";

/** "Precisa da sua ação" fechado por padrão: abre no botão, pelo link do cartão (#acoes) ou pelo sino. */
export default function AcoesRecolhidas({ total, children }: { total: number; children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    const ver = () => { if (location.hash === "#acoes") setAberto(true); };
    ver();
    window.addEventListener("hashchange", ver);
    return () => window.removeEventListener("hashchange", ver);
  }, []);
  return (
    <section className={`cartao acoes-recolhidas${aberto ? " aberto" : ""}`} id="acoes">
      <div className="cartao-topo">
        <h2 className="titulo-cartao">
          <span className="acao-sinal" aria-hidden="true">!</span>
          {total} empresa{total > 1 ? "s precisam" : " precisa"} da sua ação
        </h2>
        <button type="button" className="secundario" aria-expanded={aberto} aria-controls="acoes-lista" onClick={() => setAberto(!aberto)}>
          {aberto ? "Esconder" : "Ver quais"}
        </button>
      </div>
      {aberto && <div id="acoes-lista">{children}</div>}
    </section>
  );
}
