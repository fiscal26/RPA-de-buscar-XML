"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

/** Camada nativa, com fechamento e posicionamento leves em navegadores antigos. */
export default function usePainelFlutuante<T extends HTMLElement>() {
  const id = useId();
  const gatilho = useRef<T>(null);
  const painel = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [fallback, setFallback] = useState(false);
  const estilo = { "--ancora": `--flutuante-${id.replace(/[^a-z0-9]/gi, "")}` } as CSSProperties;
  useEffect(() => {
    const el = painel.current;
    if (!el) return;
    const nativo = "popover" in HTMLElement.prototype;
    setFallback(!nativo);
    if (nativo) {
      if (aberto && !el.matches(":popover-open")) {
        const mostrar = el.showPopover as (opcoes?: { source?: HTMLElement }) => void;
        mostrar.call(el, { source: gatilho.current ?? undefined });
      }
      else if (!aberto && el.matches(":popover-open")) el.hidePopover();
    }
    if (!aberto) return;
    const posicionar = () => {
      if (nativo && CSS.supports("position-area: block-end")) return;
      const r = gatilho.current?.getBoundingClientRect();
      if (!r) return;
      const altura = Math.min(el.scrollHeight, innerHeight - 24);
      el.style.top = `${r.bottom + 6 + altura <= innerHeight ? r.bottom + 6 : Math.max(12, r.top - altura - 6)}px`;
      el.style.left = `${Math.max(12, Math.min(r.left, innerWidth - el.offsetWidth - 12))}px`;
    };
    const frame = requestAnimationFrame(posicionar);
    const observador = typeof ResizeObserver === "function" ? new ResizeObserver(posicionar) : null;
    observador?.observe(el);
    const fora = (e: PointerEvent) => {
      if (!nativo && !el.contains(e.target as Node) && !gatilho.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setAberto(false); gatilho.current?.focus(); }
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      cancelAnimationFrame(frame);
      observador?.disconnect();
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [aberto]);
  return { id, gatilho, painel, aberto, setAberto, estilo,
    painelProps: { id, popover: "auto" as const, style: estilo,
      "data-fallback": fallback && aberto ? "aberto" : undefined,
      onToggle: (e: React.ToggleEvent<HTMLDivElement>) => setAberto(e.newState === "open") },
  };
}
