"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITENS = [
  { href: "/painel", nome: "Agendar" },
  { href: "/painel/agendamentos", nome: "Agendamentos" },
  { href: "/painel/empresas", nome: "Empresas" },
];

/** Abas do painel: a da página aberta fica marcada. */
export default function NavPainel() {
  const caminho = usePathname();
  return (
    <nav className="abas" aria-label="Painel">
      {ITENS.map((i) => {
        const ativo = i.href === "/painel" ? caminho === "/painel" : caminho.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={ativo ? "page" : undefined}>
            {i.nome}
          </Link>
        );
      })}
    </nav>
  );
}
