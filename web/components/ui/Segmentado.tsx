"use client";

/** Escolha entre poucas opções, lado a lado (no lugar das bolinhas de rádio). Vai no formulário pelo `nome`. */
export default function Segmentado<T extends string>({ nome, valor, aoMudar, opcoes, rotulo }: {
  nome: string; valor: T; aoMudar: (v: T) => void; opcoes: { id: T; texto: string }[]; rotulo: string;
}) {
  return (
    <div className="segmentado" role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o) => (
        <label key={o.id} className={o.id === valor ? "ativo" : ""}>
          <input type="radio" className="sr" name={nome} value={o.id} checked={o.id === valor} onChange={() => aoMudar(o.id)} />
          {o.texto}
        </label>
      ))}
    </div>
  );
}
