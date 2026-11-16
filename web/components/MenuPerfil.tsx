"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icone from "./Icones";
import { sair } from "@/app/login/actions";
import usePainelFlutuante from "./ui/usePainelFlutuante";
import InstalarApp from "./InstalarApp";

type Tema = "claro" | "escuro";
export default function MenuPerfil({ nome, detalhe }: { nome: string; detalhe?: string }) {
  const p = usePainelFlutuante<HTMLButtonElement>();
  const [tema, setTema] = useState<Tema>("claro");
  useEffect(() => { setTema(document.documentElement.dataset.tema === "escuro" ? "escuro" : "claro"); }, []);
  function trocarTema() {
    const novo = tema === "escuro" ? "claro" : "escuro";
    document.documentElement.dataset.tema = novo;
    try { localStorage.setItem("tema", novo); } catch {}
    setTema(novo);
  }
  return <div className="perfil" style={p.estilo}>
    <button ref={p.gatilho} type="button" className="perfil-botao" aria-expanded={p.aberto} aria-controls={p.id} onClick={() => p.setAberto(!p.aberto)}>
      <span className="avatar" aria-hidden="true">{nome.slice(0, 1).toUpperCase()}</span>
      <span className="barra-nome">{nome}{detalhe && <small>{detalhe}</small>}</span>
      <Icone nome={p.aberto ? "acima" : "abaixo"} tamanho={16} />
    </button>
    <div {...p.painelProps} ref={p.painel} className="perfil-menu painel-flutuante" aria-label="Opções do perfil">
      <Link href="/painel/perfil" onClick={() => p.setAberto(false)}><Icone nome="pessoa" tamanho={18} />Meu perfil</Link>
      <button type="button" aria-pressed={tema === "escuro"} onClick={trocarTema}>
        <Icone nome="lua" tamanho={18} />Tema escuro<span className="perfil-etiqueta">{tema === "escuro" ? "Ativado" : "Desativado"}</span>
      </button>
      <InstalarApp />
      <hr />
      <form action={sair}><button type="submit" className="perfil-sair"><Icone nome="sair" tamanho={18} />Sair</button></form>
    </div>
  </div>;
}
