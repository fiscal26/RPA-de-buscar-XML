"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type Ref } from "react";

type Campo = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Erro = { id: string; rotulo: string; mensagem: string };
const eCampo = (el: EventTarget): el is Campo => el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
function mensagem(c: Campo) {
  if (c.validity.valueMissing) return c instanceof HTMLInputElement && c.type === "file" ? "Escolha o arquivo para continuar." : "Preencha este campo para continuar.";
  if (c.validity.typeMismatch && c instanceof HTMLInputElement && c.type === "email") return "Informe um e-mail no formato nome@exemplo.com.";
  if (c.validity.tooShort && c instanceof HTMLInputElement) return `Use pelo menos ${c.minLength} caracteres.`;
  if (c.validity.rangeUnderflow) return "Escolha um valor a partir do mínimo informado.";
  if (c.validity.rangeOverflow) return "Escolha um valor até o máximo informado.";
  return c.validationMessage || "Confira o valor informado.";
}

/** Validação nativa: preserva o foco do navegador e associa cada erro ao campo. */
export default function Formulario({ children, ref: externo, ...props }: ComponentProps<"form"> & { ref?: Ref<HTMLFormElement> }) {
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const [erros, setErros] = useState<Erro[]>([]);
  const [anuncio, setAnuncio] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const inicializar = () => form.current?.querySelectorAll<Campo>("input,select,textarea").forEach((c) => {
      if (c.willValidate && !c.hasAttribute("aria-invalid")) c.setAttribute("aria-invalid", "false");
    });
    inicializar();
    const observer = new MutationObserver(inicializar);
    if (form.current) observer.observe(form.current, { childList: true, subtree: true });
    return () => { observer.disconnect(); clearTimeout(timer.current); };
  }, []);
  function sincronizar(c: Campo, forcar = false, anunciar = false) {
    if (!c.willValidate) return;
    if (!c.id) c.id = `${id}-campo-${Array.from(form.current?.elements ?? []).indexOf(c)}`;
    const erroId = `${c.id}-erro`;
    let invalido = !c.validity.valid && forcar;
    try { invalido ||= c.matches(":user-invalid"); } catch { /* HTML validation remains available. */ }
    c.setAttribute("aria-invalid", String(invalido));
    const descricoes = (c.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((v) => v && v !== erroId);
    if (invalido) descricoes.push(erroId);
    if (descricoes.length) c.setAttribute("aria-describedby", descricoes.join(" ")); else c.removeAttribute("aria-describedby");
    const rotulo = c.getAttribute("aria-label") || c.labels?.[0]?.textContent?.trim() || c.name || "Campo";
    const erro = { id: c.id, rotulo, mensagem: mensagem(c) };
    setErros((atuais) => {
      const outros = atuais.filter((e) => e.id !== c.id);
      return invalido ? [...outros, erro] : outros;
    });
    clearTimeout(timer.current);
    setAnuncio("");
    if (invalido && anunciar) timer.current = setTimeout(() => setAnuncio(`${rotulo}: ${erro.mensagem}`), 500);
  }
  return <form {...props} ref={(el) => {
    form.current = el;
    if (typeof externo === "function") externo(el); else if (externo) externo.current = el;
  }}
    onInvalidCapture={(e) => { if (eCampo(e.target)) sincronizar(e.target, true); props.onInvalidCapture?.(e); }}
    onBlurCapture={(e) => { if (eCampo(e.target)) sincronizar(e.target, false, true); props.onBlurCapture?.(e); }}
    onChangeCapture={(e) => { if (eCampo(e.target)) sincronizar(e.target, false, true); props.onChangeCapture?.(e); }}
    onInputCapture={(e) => { if (eCampo(e.target)) sincronizar(e.target); props.onInputCapture?.(e); }}
    onReset={(e) => {
      setErros([]); setAnuncio(""); clearTimeout(timer.current);
      form.current?.querySelectorAll<Campo>("[aria-invalid]").forEach((c) => {
        c.setAttribute("aria-invalid", "false");
        const ids = (c.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((v) => v && v !== `${c.id}-erro`);
        if (ids.length) c.setAttribute("aria-describedby", ids.join(" ")); else c.removeAttribute("aria-describedby");
      });
      props.onReset?.(e);
    }}>
    {erros.length > 0 && <div className="validacao-resumo faixa erro">
      <b>Confira os campos para continuar</b>
      <ul>{erros.map((e) => <li key={e.id} id={`${e.id}-erro`}><a href={`#${e.id}`} onClick={(ev) => {
        ev.preventDefault(); document.getElementById(e.id)?.focus();
      }}>{e.rotulo}: {e.mensagem}</a></li>)}</ul>
    </div>}
    <span className="sr" role="status">{anuncio}</span>
    {children}
  </form>;
}
