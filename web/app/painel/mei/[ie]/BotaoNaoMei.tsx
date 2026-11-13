"use client";

import BotaoConfirmar from "@/components/ui/BotaoConfirmar";

/** Tira do Monitoramento MEI uma empresa que não é MEI (pede confirmação: apaga o faturamento lido dela). */
export default function BotaoNaoMei({ nome }: { nome: string }) {
  return (
    <BotaoConfirmar className="secundario perigo-texto" titulo={`Pausar acompanhamento de ${nome}?`} confirmar="Pausar acompanhamento"
      texto="A empresa sai do monitoramento e o serviço MEI fica desmarcado na SEFAZ. O histórico e os lançamentos são preservados. Para apenas registrar o fim do enquadramento, edite o cadastro MEI em Empresas.">
      Pausar acompanhamento MEI
    </BotaoConfirmar>
  );
}
