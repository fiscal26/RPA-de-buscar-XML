"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Escolha from "@/components/ui/Escolha";

/** Troca o ano do monitoramento (mantém os outros parâmetros da página). */
export default function SeletorAno({ ano, atual }: { ano: number; atual: number }) {
  const router = useRouter(), caminho = usePathname(), params = useSearchParams();
  const anos = Array.from({ length: 4 }, (_, i) => atual - i);
  return (
    <Escolha rotulo="Ano" valor={String(ano)} avatar={false} compacta opcoes={anos.map((a) => ({ id: String(a), titulo: String(a) }))}
      aoMudar={(v) => {
        const p = new URLSearchParams(params);
        p.set("ano", v);
        router.push(`${caminho}?${p}`);
      }} />
  );
}
