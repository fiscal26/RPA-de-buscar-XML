"use client";

import { useEffect, useState } from "react";

/** O robô trabalhando no ATF, ao vivo: cada passo do registro faz aparecer a pasta correspondente.
 *  Roda em ciclo (uma competência inteira) e, para quem pede menos movimento, mostra a pasta pronta. */
type Linha = { nivel: number; nome: string; valor?: string; arquivo?: string };

const LINHAS: Linha[] = [
  { nivel: 0, nome: "Arquivos baixados" },
  { nivel: 1, nome: "015-Padaria Central" },
  { nivel: 2, nome: "2026-09" },
  { nivel: 3, nome: "NF-e Saida", valor: "R$ 48.213,90", arquivo: "NF-e Saida 2026-09.zip" },
  { nivel: 3, nome: "NF-e Entrada", valor: "R$ 31.087,44", arquivo: "NF-e Entrada 2026-09.zip" },
  { nivel: 3, nome: "NFC-e", valor: "R$ 12.930,15", arquivo: "NFC-e 2026-09.zip" },
  { nivel: 3, nome: "CT-e Destinatario", valor: "R$ 1.450,00", arquivo: "CT-e Destinatario 2026-09.zip" },
  { nivel: 3, nome: "Faturas", arquivo: "Faturas 2026-09.pdf" },
  { nivel: 3, nome: "Certidão de Débitos", arquivo: "Certidão de Débitos 2026-09.pdf" },
  { nivel: 1, nome: "021-Ateliê Ponto Fino" },
  { nivel: 2, nome: "Dossiê MEI", arquivo: "Faturamento MEI 2026.xlsx" },
];

// [o que o robô está fazendo, quantas linhas da pasta já existem]
const PASSOS: [string, number][] = [
  ["Entrando no ATF com o login do contador", 0],
  ["Padaria Central: consultas de NF-e, NFC-e e CT-e enviadas", 3],
  ["Minhas Mensagens: XML das NF-e de saída recebido", 4],
  ["Minhas Mensagens: XML das NF-e de entrada recebido", 5],
  ["Minhas Mensagens: XML das NFC-e recebido", 6],
  ["Minhas Mensagens: XML dos CT-e recebido", 7],
  ["Faturas: DAR/PIX dos lançamentos em aberto emitido", 8],
  ["Certidão de débitos emitida", 9],
  ["Ateliê Ponto Fino: faturamento MEI do ano atualizado", 11],
  ["Competência 09/2026 concluída", 11],
];
const FINAL = PASSOS.length - 1;

export default function AtfAoVivo() {
  const [passo, setPasso] = useState(FINAL);
  const [ativo, setAtivo] = useState(false);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setAtivo(true);
    setPasso(0);
    let atual = 0;
    let t: ReturnType<typeof setTimeout>;
    const seguir = () => {
      atual = atual >= FINAL ? 0 : atual + 1;
      setPasso(atual);
      t = setTimeout(seguir, atual === FINAL ? 4200 : atual === 0 ? 1300 : 1150);
    };
    t = setTimeout(seguir, 1300);
    return () => clearTimeout(t);
  }, []);

  const visiveis = PASSOS[passo][1];
  const concluido = passo === FINAL;
  return (
    <figure className="ao-vivo" aria-label="Exemplo da pasta que o robô monta numa competência">
      <div className="ao-vivo-topo">
        <span className={`ao-vivo-estado ${concluido ? "pronto" : ""}`}>{concluido ? "Concluído" : "Robô no ATF"}</span>
        <span className="ao-vivo-log" key={passo} aria-live="off">{PASSOS[passo][0]}</span>
      </div>
      <ul className="arvore-lista">
        {LINHAS.map((l, i) => (
          <li key={l.nome} className={`arvore-linha ${i < visiveis ? "visivel" : ""} ${ativo && i === visiveis - 1 && !concluido ? "nova" : ""}`}
            style={{ "--nivel": l.nivel } as React.CSSProperties}>
            <span className="arvore-pasta">
              <svg className="icone-pasta" viewBox="0 0 16 13" aria-hidden="true">
                <path d="M1 2.2C1 1.5 1.5 1 2.2 1h3.6l1.6 1.6h6.4c.7 0 1.2.5 1.2 1.2v7c0 .7-.5 1.2-1.2 1.2H2.2C1.5 12 1 11.5 1 10.8z" />
              </svg>
              {l.nome}
              {l.valor && <> - <mark>{l.valor}</mark></>}
            </span>
            {l.arquivo && <span className="arvore-arquivo">{l.arquivo}</span>}
          </li>
        ))}
      </ul>
      <figcaption>O ZIP fica como veio do ATF; o valor no nome da pasta soma as notas autorizadas, sem as canceladas.</figcaption>
    </figure>
  );
}
