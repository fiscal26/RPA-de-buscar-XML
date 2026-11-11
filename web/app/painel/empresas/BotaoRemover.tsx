"use client";

import Icone from "@/components/Icones";
import BotaoConfirmar from "@/components/ui/BotaoConfirmar";

/** Lixeira que pede confirmação (num diálogo da marca) antes de apagar: empresa, certificado, monitoramento. */
export default function BotaoRemover({ apelido, pergunta }: { apelido: string; pergunta?: string }) {
  return (
    <BotaoConfirmar className="perigo botao-icone" rotulo={`Excluir ${apelido}`} dica="Excluir"
      titulo={pergunta ? `Tirar ${apelido}?` : `Excluir ${apelido}?`}
      texto={pergunta ?? "Sai do cadastro. Os arquivos já baixados continuam na pasta."} confirmar={pergunta ? "Tirar" : "Excluir"}>
      <Icone nome="lixeira" tamanho={18} />
    </BotaoConfirmar>
  );
}
