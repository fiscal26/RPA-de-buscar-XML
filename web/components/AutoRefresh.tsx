"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Atualiza a página a cada `segundos` enquanto houver pedidos na fila/em emissão. */
export default function AutoRefresh({ ativo, segundos = 5 }: { ativo: boolean; segundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => router.refresh(), segundos * 1000);
    return () => clearInterval(t);
  }, [ativo, segundos, router]);
  return null;
}
