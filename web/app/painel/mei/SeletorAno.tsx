"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Troca o ano do monitoramento (mantém os outros parâmetros da página). */
export default function SeletorAno({ ano, atual }: { ano: number; atual: number }) {
  const router = useRouter(), caminho = usePathname(), params = useSearchParams();
  const anos = Array.from({ length: 4 }, (_, i) => atual - i);
  return (
    <select className="seletor-ano" aria-label="Ano" value={ano}
      onChange={(e) => {
        const p = new URLSearchParams(params);
        p.set("ano", e.target.value);
        router.push(`${caminho}?${p}`);
      }}>
      {anos.map((a) => <option key={a} value={a}>{a}</option>)}
    </select>
  );
}
