"use client";

import { flushSync } from "react-dom";

/** A mudança funciona imediatamente sem a API ou quando a pessoa prefere menos movimento. */
export function transicaoSuave(atualizar: () => void) {
  if (typeof document.startViewTransition !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    atualizar(); return;
  }
  const transicao = document.startViewTransition(() => flushSync(atualizar));
  void transicao.finished.catch(() => { /* Uma animação cancelada não desfaz a mudança. */ });
}
