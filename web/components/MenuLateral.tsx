"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icone from "./Icones";

type Item = { href: string; nome: string; icone: string };

/** Menu do painel: o item da página aberta fica marcado. */
export default function MenuLateral({ itens, extras }: { itens: Item[]; extras: Item[] }) {
  const caminho = usePathname();
  const ativo = (href: string) => (href === "/painel" ? caminho === "/painel" : caminho.startsWith(href));
  const link = (i: Item) => (
    <Link key={i.href} href={i.href} aria-current={ativo(i.href) ? "page" : undefined}>
      <Icone nome={i.icone} />
      <span>{i.nome}</span>
    </Link>
  );
  return (
    <nav className="lateral" aria-label="Painel">
      {itens.map(link)}
      {!!extras.length && <hr />}
      {extras.map(link)}
    </nav>
  );
}
