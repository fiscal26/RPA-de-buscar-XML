"use client";

import { transicaoSuave } from "@/lib/transicao";
export default function Paginacao({ total, pagina, tamanho = 25, aoMudar, rotulo }: {
  total: number; pagina: number; tamanho?: number; aoMudar: (pagina: number) => void; rotulo: string;
}) {
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  return <div className="listagem-rodape"><span role="status">{total ? `${(pagina - 1) * tamanho + 1}–${Math.min(pagina * tamanho, total)} de ${total}` : "Nenhum resultado"}</span>
    {paginas > 1 && <nav aria-label={rotulo}>
      <button type="button" className="secundario pequeno" disabled={pagina <= 1} onClick={() => transicaoSuave(() => aoMudar(pagina - 1))}>Anterior</button>
      <span>Página {pagina} de {paginas}</span>
      <button type="button" className="secundario pequeno" disabled={pagina >= paginas} onClick={() => transicaoSuave(() => aoMudar(pagina + 1))}>Próxima</button>
    </nav>}
  </div>;
}
