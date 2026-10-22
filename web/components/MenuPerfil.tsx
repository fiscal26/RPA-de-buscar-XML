"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Icone from "./Icones";
import { sair } from "@/app/login/actions";

type Tema = "claro" | "escuro";

/** Botão do usuário na barra do painel: abre o menu com Meu perfil, Tema e Sair. */
export default function MenuPerfil({ nome, detalhe }: { nome: string; detalhe?: string }) {
  const [aberto, setAberto] = useState(false);
  const [tema, setTema] = useState<Tema>("claro");
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTema(document.documentElement.dataset.tema === "escuro" ? "escuro" : "claro");
  }, []);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  function trocarTema() {
    const novo: Tema = tema === "escuro" ? "claro" : "escuro";
    document.documentElement.dataset.tema = novo;
    try { localStorage.setItem("tema", novo); } catch {}
    setTema(novo);
  }

  return (
    <div className="perfil" ref={caixa}>
      <button type="button" className="perfil-botao" aria-expanded={aberto} aria-haspopup="menu" onClick={() => setAberto(!aberto)}>
        <span className="avatar" aria-hidden="true">{nome.slice(0, 1).toUpperCase()}</span>
        <span className="barra-nome">{nome}{detalhe && <small>{detalhe}</small>}</span>
        <Icone nome={aberto ? "acima" : "abaixo"} tamanho={16} />
      </button>
      {aberto && (
        <div className="perfil-menu" role="menu">
          <Link href="/painel/perfil" role="menuitem" onClick={() => setAberto(false)}>
            <Icone nome="pessoa" tamanho={18} />Meu perfil
          </Link>
          <button type="button" role="menuitemcheckbox" aria-checked={tema === "escuro"} onClick={trocarTema}>
            <Icone nome="lua" tamanho={18} />Tema<span className="perfil-etiqueta">{tema === "escuro" ? "Escuro" : "Claro"}</span>
          </button>
          <hr />
          <form action={sair}>
            <button type="submit" role="menuitem" className="perfil-sair"><Icone nome="sair" tamanho={18} />Sair</button>
          </form>
        </div>
      )}
    </div>
  );
}
