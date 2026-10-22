"use client";

import { useEffect, useState } from "react";
import Icone from "./Icones";

/** Alterna claro/escuro fora do painel (página inicial e login). */
export default function BotaoTema() {
  const [escuro, setEscuro] = useState(false);
  useEffect(() => setEscuro(document.documentElement.dataset.tema === "escuro"), []);
  function trocar() {
    const novo = escuro ? "claro" : "escuro";
    document.documentElement.dataset.tema = novo;
    try { localStorage.setItem("tema", novo); } catch {}
    setEscuro(!escuro);
  }
  return (
    <button type="button" className="botao fantasma botao-tema" onClick={trocar}
      aria-label={escuro ? "Usar o tema claro" : "Usar o tema escuro"} title={escuro ? "Tema claro" : "Tema escuro"}>
      <Icone nome="lua" tamanho={18} />
    </button>
  );
}
