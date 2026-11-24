"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import Icone from "./Icones";

type Item = { href: string; nome: string; icone: string };
type Grupo = { titulo: string; itens: Item[] };

export default function MenuLateral({ grupos }: { grupos: Grupo[] }) {
  const caminho = usePathname();
  const id = useId();
  const ativo = (href: string) => caminho === href || (href !== "/painel" && caminho.startsWith(`${href}/`));
  return (
    <nav className="lateral" aria-label="Painel">
      {grupos.filter(({ itens }) => itens.length > 0).map(({ titulo, itens }, indice) => (
        <div key={titulo} className="lateral-grupo" role="group" aria-labelledby={`${id}-${indice}`}>
          <p className="lateral-titulo" id={`${id}-${indice}`}>{titulo}</p>
          <div className="lateral-itens">
            {itens.map(({ href, nome, icone }) => (
              <Link key={href} href={href} aria-current={ativo(href) ? "page" : undefined}>
                <Icone nome={icone} />
                <span>{nome}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
