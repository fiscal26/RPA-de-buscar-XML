"use client";

/** Tira do Monitoramento MEI uma empresa que não é MEI (pede confirmação: apaga o faturamento lido dela). */
export default function BotaoNaoMei({ nome }: { nome: string }) {
  return (
    <button type="submit" className="secundario perigo-texto" onClick={(e) => {
      if (!confirm(`${nome} não é MEI? Ela sai do Monitoramento MEI: o faturamento lido do ATF, os lançamentos e os `
        + "alertas dela são apagados e o serviço MEI fica desmarcado no cadastro.")) e.preventDefault();
    }}>
      Não é MEI: tirar do monitoramento
    </button>
  );
}
