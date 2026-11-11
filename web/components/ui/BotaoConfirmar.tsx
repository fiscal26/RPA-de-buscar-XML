"use client";

import { useRef } from "react";

/**
 * Botão que pede confirmação num diálogo da marca (no lugar do aviso do navegador) e só então envia o
 * formulário em que está. Use dentro de um <form>.
 */
export default function BotaoConfirmar({ children, className, rotulo, dica, titulo, texto, confirmar = "Excluir", desativado }: {
  children: React.ReactNode; className?: string; rotulo?: string; dica?: string; titulo: string; texto?: string;
  confirmar?: string; desativado?: boolean;
}) {
  const botao = useRef<HTMLButtonElement>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button ref={botao} type="button" className={className} aria-label={rotulo} data-dica={dica} disabled={desativado}
        onClick={() => dialogo.current?.showModal()}>
        {children}
      </button>
      <dialog ref={dialogo} className="dialogo" aria-label={titulo} onClick={(e) => { if (e.target === dialogo.current) dialogo.current?.close(); }}>
        <div className="dialogo-corpo">
          <h2>{titulo}</h2>
          {texto && <p className="suave">{texto}</p>}
        </div>
        <div className="dialogo-rodape">
          <button type="button" className="secundario" onClick={() => dialogo.current?.close()}>Voltar</button>
          <button type="button" className="perigo-cheio" onClick={() => { dialogo.current?.close(); botao.current?.form?.requestSubmit(); }}>
            {confirmar}
          </button>
        </div>
      </dialog>
    </>
  );
}
