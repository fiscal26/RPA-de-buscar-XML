import type { ReactNode } from "react";

/** Mantém a semântica da tabela e permite rolar colunas também pelo teclado. */
export default function Tabela({ rotulo, className = "", children }: {
  rotulo: string; className?: string; children: ReactNode;
}) {
  return <div className={`tabela-rolagem tabela-painel ${className}`} role="region" aria-label={rotulo} tabIndex={0}>
    {children}
  </div>;
}
