"use client";

import Icone from "@/components/Icones";

/** Lixeira que pede confirmação antes de apagar (empresa, certificado). O nome aparece num balão. */
export default function BotaoRemover({ apelido }: { apelido: string }) {
  return (
    <button
      type="submit"
      className="perigo botao-icone"
      aria-label={`Excluir ${apelido}`}
      data-dica="Excluir"
      onClick={(e) => {
        if (!confirm(`Excluir ${apelido} do cadastro?`)) e.preventDefault();
      }}
    >
      <Icone nome="lixeira" tamanho={18} />
    </button>
  );
}
