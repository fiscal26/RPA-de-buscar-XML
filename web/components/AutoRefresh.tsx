"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Pausa a consulta com a aba escondida ou sem internet; atualiza ao voltar. */
export default function AutoRefresh({ ativo, segundos = 5 }: { ativo: boolean; segundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!ativo) return;
    let timer: ReturnType<typeof setTimeout>;
    let ultima = 0;
    const atualizar = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (Date.now() - ultima >= 1000) { ultima = Date.now(); router.refresh(); }
      timer = setTimeout(atualizar, segundos * 1000);
    };
    timer = setTimeout(atualizar, segundos * 1000);
    document.addEventListener("visibilitychange", atualizar);
    window.addEventListener("online", atualizar);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", atualizar); window.removeEventListener("online", atualizar); };
  }, [ativo, segundos, router]);
  return null;
}
