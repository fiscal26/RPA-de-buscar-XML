import { Children, cloneElement, isValidElement, type ReactNode, type ReactElement } from "react";

type Elemento = ReactElement<{ children?: ReactNode; role?: string; "data-label"?: string }>;
const elemento = (n: ReactNode): n is Elemento => isValidElement(n);
function texto(n: ReactNode): string {
  return Children.toArray(n).map((x) => elemento(x) ? texto(x.props.children) : typeof x === "string" || typeof x === "number" ? String(x) : "").join(" ").trim();
}
function adaptar(tabela: Elemento) {
  const partes = Children.toArray(tabela.props.children);
  const cabeca = partes.find((p) => elemento(p) && p.type === "thead") as Elemento | undefined;
  const linha = cabeca && Children.toArray(cabeca.props.children).find(elemento);
  const rotulos = linha ? Children.toArray(linha.props.children).map(texto) : [];
  return cloneElement(tabela, { role: "table" }, partes.map((parte) => {
    if (!elemento(parte) || !["thead", "tbody", "tfoot"].includes(String(parte.type))) return parte;
    return cloneElement(parte, { role: "rowgroup" }, Children.map(parte.props.children, (tr) => {
      if (!elemento(tr)) return tr;
      return cloneElement(tr, { role: "row" }, Children.map(tr.props.children, (celula, i) => {
        if (!elemento(celula)) return celula;
        return cloneElement(celula, { role: celula.type === "th" ? parte.type === "thead" ? "columnheader" : "rowheader" : "cell",
          "data-label": celula.props["data-label"] ?? rotulos[i] });
      }));
    }));
  }));
}

/** Preserva cabeçalhos e leitura por teclado; as linhas viram cartões em espaços estreitos. */
export default function Tabela({ rotulo, className = "", children }: {
  rotulo: string; className?: string; children: ReactNode;
}) {
  return <div className={`tabela-rolagem tabela-painel tabela-adaptavel ${className}`} role="region" aria-label={rotulo} tabIndex={0}>
    {Children.map(children, (c) => elemento(c) && c.type === "table" ? adaptar(c) : c)}
  </div>;
}
