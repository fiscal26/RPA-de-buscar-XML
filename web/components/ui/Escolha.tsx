"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icone from "@/components/Icones";
import { iniciais } from "@/lib/documentos";

export type Opcao = { id: string; titulo: string; sub?: string; etiqueta?: string; grupo?: string; desativada?: boolean };

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Seletor da marca, no lugar da lista nativa do navegador: mostra as iniciais (ou uma etiqueta), o nome e uma
 * linha de apoio; com muitas opções vira um campo que filtra enquanto se digita. Setas, Enter e Esc funcionam.
 * O valor escolhido vai no formulário pelo campo oculto `nome`.
 */
export default function Escolha({ nome, opcoes, valor, padrao = "", aoMudar, rotulo, placeholder = "Escolha…", busca, avatar = true, id, compacta }: {
  nome?: string; opcoes: Opcao[]; valor?: string; padrao?: string; aoMudar?: (id: string) => void;
  rotulo: string; placeholder?: string; busca?: boolean; avatar?: boolean; id?: string; compacta?: boolean;
}) {
  const [interno, setInterno] = useState(padrao);
  const atual = valor ?? interno;
  const [aberto, setAberto] = useState(false);
  const [foco, setFoco] = useState(0);
  const [filtro, setFiltro] = useState("");
  const raiz = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const gatilho = useRef<HTMLButtonElement>(null);
  const comBusca = busca ?? opcoes.length > 8;
  const escolhida = opcoes.find((o) => o.id === atual) ?? null;

  const visiveis = useMemo(() => {
    const q = semAcento(filtro.trim()), d = filtro.replace(/\D/g, "");
    if (!comBusca || !q) return opcoes;
    return opcoes.filter((o) => semAcento(`${o.titulo} ${o.etiqueta ?? ""} ${o.sub ?? ""}`).includes(q) || (d.length >= 3 && (o.sub ?? "").replace(/\D/g, "").includes(d)));
  }, [opcoes, filtro, comBusca]);

  useEffect(() => { setFoco(Math.max(0, visiveis.findIndex((o) => o.id === atual))); }, [filtro, aberto]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);
  // o formulário foi limpo (depois de salvar): volta ao valor inicial
  useEffect(() => {
    const form = raiz.current?.closest("form");
    if (!form || valor !== undefined) return;
    const limpar = () => { setInterno(padrao); setFiltro(""); };
    form.addEventListener("reset", limpar);
    return () => form.removeEventListener("reset", limpar);
  }, [padrao, valor]);

  function escolher(o: Opcao) {
    if (o.desativada) return;
    setAberto(false); setFiltro("");
    if (valor === undefined) setInterno(o.id);
    aoMudar?.(o.id);
    setTimeout(() => gatilho.current?.focus(), 0);
  }
  function teclas(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!aberto) setAberto(true); else setFoco((f) => Math.min(f + 1, visiveis.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFoco((f) => Math.max(f - 1, 0)); }
    else if (e.key === "Enter" && aberto && visiveis[foco]) { e.preventDefault(); escolher(visiveis[foco]); }
    else if (e.key === "Escape" && aberto) { e.preventDefault(); e.stopPropagation(); setAberto(false); }
    else if (e.key === "Tab") setAberto(false);
  }

  const marca = (o: Opcao) => o.etiqueta ? <span className="apelido">{o.etiqueta}</span>
    : avatar ? <span className="avatar-q" aria-hidden="true">{iniciais(o.titulo)}</span> : null;
  const texto = (o: Opcao) => <span className="escolha-texto"><b>{o.titulo}</b>{o.sub && <small>{o.sub}</small>}</span>;

  const lista = aberto && (
    <div className="escolha-lista" role="listbox" aria-label={rotulo}>
      {visiveis.map((o, i) => (
        <div key={o.id || "vazio"}>
          {o.grupo && o.grupo !== visiveis[i - 1]?.grupo && <p className="escolha-grupo">{o.grupo}</p>}
          <button type="button" role="option" aria-selected={o.id === atual} aria-disabled={o.desativada || undefined}
            className={`${i === foco ? "foco" : ""}${o.id === atual ? " atual" : ""}`} tabIndex={-1}
            onMouseEnter={() => setFoco(i)} onMouseDown={(e) => { e.preventDefault(); escolher(o); }}>
            {marca(o)}{texto(o)}
            {o.id === atual && <Icone nome="visto" tamanho={16} />}
          </button>
        </div>
      ))}
      {!visiveis.length && <p className="escolha-vazio">Nada encontrado.</p>}
    </div>
  );
  const oculto = nome ? <input type="hidden" name={nome} value={atual} /> : null;
  const classes = `escolha-campo${aberto ? " aberta" : ""}${compacta ? " compacta" : ""}`;

  if (comBusca && !escolhida) {
    return (
      <div className={classes} ref={raiz}>
        {oculto}
        <Icone nome="busca" tamanho={16} />
        <input ref={campo} id={id} type="text" value={filtro} placeholder={placeholder} aria-label={rotulo} role="combobox"
          aria-expanded={aberto} aria-controls={undefined} autoComplete="off"
          onChange={(e) => { setFiltro(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)} onKeyDown={teclas} />
        {lista}
      </div>
    );
  }
  return (
    <div className={`${classes}${escolhida ? " escolhida" : ""}`} ref={raiz}>
      {oculto}
      <button ref={gatilho} id={id} type="button" className="escolha-gatilho" aria-haspopup="listbox" aria-expanded={aberto} aria-label={rotulo}
        onClick={() => setAberto(!aberto)} onKeyDown={teclas}>
        {escolhida ? <>{marca(escolhida)}{texto(escolhida)}</> : <span className="escolha-texto suave">{placeholder}</span>}
        <Icone nome={aberto ? "acima" : "abaixo"} tamanho={16} />
      </button>
      {comBusca && escolhida && (
        <button type="button" className="escolha-trocar" aria-label={`Trocar ${rotulo.toLowerCase()}`} title="Trocar"
          onClick={() => { if (valor === undefined) setInterno(""); aoMudar?.(""); setAberto(true); setTimeout(() => campo.current?.focus(), 0); }}>
          <Icone nome="fechar" tamanho={14} />
        </button>
      )}
      {lista}
    </div>
  );
}
