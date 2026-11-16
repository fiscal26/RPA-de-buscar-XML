"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icone from "@/components/Icones";
import { iniciais } from "@/lib/documentos";
import usePainelFlutuante from "./usePainelFlutuante";

export type Opcao = { id: string; titulo: string; sub?: string; etiqueta?: string; grupo?: string; desativada?: boolean };
const semAcento = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function Escolha({ nome, opcoes, valor, padrao = "", aoMudar, rotulo, placeholder = "Escolha…", busca, avatar = true, id, compacta }: {
  nome?: string; opcoes: Opcao[]; valor?: string; padrao?: string; aoMudar?: (id: string) => void;
  rotulo: string; placeholder?: string; busca?: boolean; avatar?: boolean; id?: string; compacta?: boolean;
}) {
  const [interno, setInterno] = useState(padrao);
  const [filtro, setFiltro] = useState("");
  const [editando, setEditando] = useState(false);
  const [foco, setFoco] = useState(-1);
  const raiz = useRef<HTMLDivElement>(null);
  const p = usePainelFlutuante<HTMLInputElement | HTMLButtonElement>();
  const atual = valor ?? interno;
  const comBusca = busca ?? opcoes.length > 8;
  const escolhida = opcoes.find((o) => o.id === atual);
  const visiveis = useMemo(() => {
    const q = semAcento(filtro.trim()), d = filtro.replace(/\D/g, "");
    return !comBusca || !q ? opcoes : opcoes.filter((o) => semAcento(`${o.titulo} ${o.etiqueta ?? ""} ${o.sub ?? ""}`).includes(q)
      || (d.length >= 3 && (o.sub ?? "").replace(/\D/g, "").includes(d)));
  }, [opcoes, filtro, comBusca]);
  const ativo = foco >= 0 && visiveis[foco] && !visiveis[foco].desativada ? foco : visiveis.findIndex((o) => !o.desativada);
  useEffect(() => {
    if (p.aberto && ativo >= 0) document.getElementById(`${p.id}-opcao-${ativo}`)?.scrollIntoView({ block: "nearest" });
  }, [ativo, p.aberto, p.id]);
  useEffect(() => {
    const form = raiz.current?.closest("form");
    const limpar = () => { setInterno(padrao); setFiltro(""); setEditando(false); p.setAberto(false); };
    if (valor === undefined) form?.addEventListener("reset", limpar);
    return () => form?.removeEventListener("reset", limpar);
  }, [padrao, valor, p.setAberto]);
  function abrir() {
    setFoco(visiveis.findIndex((o) => o.id === atual && !o.desativada)); p.setAberto(true);
  }
  function escolher(o: Opcao) {
    if (o.desativada) return;
    if (valor === undefined) setInterno(o.id);
    aoMudar?.(o.id);
    setFiltro(""); setEditando(false); p.setAberto(false); p.gatilho.current?.focus();
  }
  function teclas(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    const habilitadas = visiveis.flatMap((o, i) => o.desativada ? [] : [i]);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      if (!p.aberto && ["Home", "End"].includes(e.key) && comBusca) return;
      e.preventDefault();
      const pos = habilitadas.indexOf(ativo);
      setFoco(e.key === "Home" ? habilitadas[0] ?? -1 : e.key === "End" ? habilitadas.at(-1) ?? -1
        : !p.aberto ? (e.key === "ArrowUp" ? habilitadas.at(-1) ?? -1 : habilitadas[0] ?? -1)
        : habilitadas[Math.max(0, Math.min(habilitadas.length - 1, pos + (e.key === "ArrowDown" ? 1 : -1)))] ?? -1);
      p.setAberto(true);
    } else if (!comBusca && e.key === " ") {
      e.preventDefault(); if (p.aberto && ativo >= 0) escolher(visiveis[ativo]); else abrir();
    } else if (e.key === "Enter" && p.aberto) {
      e.preventDefault(); if (ativo >= 0) escolher(visiveis[ativo]);
    } else if (e.key === "Escape" && p.aberto) {
      e.preventDefault(); e.stopPropagation(); p.setAberto(false); setEditando(false); setFiltro("");
    } else if (e.key === "Tab") { p.setAberto(false); setEditando(false); setFiltro(""); }
    else if (!comBusca && e.key.length === 1 && e.key !== " ") {
      const i = visiveis.findIndex((o) => !o.desativada && semAcento(o.titulo).startsWith(semAcento(e.key)));
      if (i >= 0) { e.preventDefault(); setFoco(i); p.setAberto(true); }
    }
  }
  const atributos = { id, role: "combobox", "aria-label": rotulo, "aria-expanded": p.aberto,
    "aria-controls": p.id, "aria-haspopup": "listbox" as const,
    "aria-activedescendant": p.aberto && ativo >= 0 ? `${p.id}-opcao-${ativo}` : undefined, onKeyDown: teclas };
  return <div ref={raiz} className={`escolha-campo${p.aberto ? " aberta" : ""}${compacta ? " compacta" : ""}`} style={p.estilo}>
    {nome && <input type="hidden" name={nome} value={atual} />}
    {comBusca ? <>
      <Icone nome="busca" tamanho={16} />
      <input {...atributos} ref={(el) => { p.gatilho.current = el; }} type="text" autoComplete="off" aria-autocomplete="list"
        placeholder={placeholder} value={editando ? filtro : escolhida?.titulo ?? ""}
        onClick={() => { if (!p.aberto) abrir(); }} onBlur={() => { setEditando(false); setFiltro(""); }}
        onChange={(e) => {
          if (atual) { if (valor === undefined) setInterno(""); aoMudar?.(""); }
          setFiltro(e.target.value); setEditando(true); setFoco(-1); p.setAberto(true);
        }} />
    </> : <button {...atributos} ref={(el) => { p.gatilho.current = el; }} type="button" className="escolha-gatilho"
      onClick={() => p.aberto ? p.setAberto(false) : abrir()}>
      {escolhida?.etiqueta ? <span className="apelido">{escolhida.etiqueta}</span> : avatar && escolhida ? <span className="avatar-q" aria-hidden="true">{iniciais(escolhida.titulo)}</span> : null}
      <span className="escolha-texto"><b>{escolhida?.titulo ?? placeholder}</b>{escolhida?.sub && <small>{escolhida.sub}</small>}</span>
      <Icone nome={p.aberto ? "acima" : "abaixo"} tamanho={16} />
    </button>}
    <div {...p.painelProps} ref={p.painel} className="escolha-lista painel-flutuante" role="listbox" aria-label={rotulo}>
      {visiveis.map((o, i) => <div key={o.id || "vazio"} role="presentation">
        {o.grupo && o.grupo !== visiveis[i - 1]?.grupo && <p className="escolha-grupo" role="presentation">{o.grupo}</p>}
        <div id={`${p.id}-opcao-${i}`} role="option" aria-selected={o.id === atual} aria-disabled={o.desativada || undefined}
          className={`escolha-opcao${i === ativo ? " foco" : ""}${o.id === atual ? " atual" : ""}`}
          onPointerMove={() => { if (!o.desativada) setFoco(i); }} onPointerDown={(e) => e.preventDefault()} onClick={() => escolher(o)}>
          {o.etiqueta ? <span className="apelido">{o.etiqueta}</span> : avatar ? <span className="avatar-q" aria-hidden="true">{iniciais(o.titulo)}</span> : null}
          <span className="escolha-texto"><b>{o.titulo}</b>{o.sub && <small>{o.sub}</small>}</span>
          {o.id === atual && <Icone nome="visto" tamanho={16} />}
        </div>
      </div>)}
      {!visiveis.length && <div className="escolha-vazio" role="presentation">Nada encontrado.</div>}
    </div>
    <span className="sr" role="status">{p.aberto && comBusca ? `${visiveis.length} opções encontradas` : ""}</span>
  </div>;
}
