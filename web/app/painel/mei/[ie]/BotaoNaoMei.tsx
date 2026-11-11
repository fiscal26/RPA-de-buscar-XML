"use client";

import BotaoConfirmar from "@/components/ui/BotaoConfirmar";

/** Tira do Monitoramento MEI uma empresa que não é MEI (pede confirmação: apaga o faturamento lido dela). */
export default function BotaoNaoMei({ nome }: { nome: string }) {
  return (
    <BotaoConfirmar className="secundario perigo-texto" titulo={`${nome} não é MEI?`} confirmar="Tirar do monitoramento"
      texto="Ela sai do Monitoramento MEI: o faturamento lido do ATF, os lançamentos e os alertas dela são apagados, e o serviço MEI fica desmarcado no cadastro.">
      Não é MEI: tirar do monitoramento
    </BotaoConfirmar>
  );
}
