"use client";

import { useState } from "react";

type Servico = { nome: string; formato: string; entrega: string; caminho: string[]; texto: string };

// Cada coluna da planilha: o que é, como o ATF entrega e onde o robô guarda
const SERVICOS: Servico[] = [
  { nome: "NF-e de saída e de entrada", formato: "XML", entrega: "Por Minhas Mensagens, minutos depois",
    caminho: ["015-Padaria Central", "2026-09", "NF-e Saida - R$ 48.213,90", "NF-e Saida 2026-09.zip"],
    texto: "Uma consulta como emitente e outra como destinatária. O ZIP fica como veio; o valor da pasta soma as notas autorizadas, sem as canceladas." },
  { nome: "NFC-e", formato: "XML", entrega: "Por Minhas Mensagens, minutos depois",
    caminho: ["015-Padaria Central", "2026-09", "NFC-e - R$ 12.930,15", "NFC-e 2026-09.zip"],
    texto: "Os cupons emitidos pela empresa na competência." },
  { nome: "CT-e", formato: "XML", entrega: "Por Minhas Mensagens, minutos depois",
    caminho: ["015-Padaria Central", "2026-09", "CT-e Destinatario - R$ 1.450,00", "CT-e Destinatario 2026-09.zip"],
    texto: "Como remetente e como destinatária, cada um na sua pasta, com o valor da prestação." },
  { nome: "Faturas", formato: "PDF", entrega: "Na hora",
    caminho: ["015-Padaria Central", "2026-09", "Faturas", "Faturas 2026-09.pdf"],
    texto: "DAR/PIX de todos os lançamentos em aberto, menos os DIFERIDO - VALOR MINIMO, que o ATF não emite." },
  { nome: "Extrato de pagamentos", formato: "PDF", entrega: "Na hora",
    caminho: ["015-Padaria Central", "2026-09", "Extrato de Pagamentos", "Extrato de Pagamentos 2026-09.pdf"],
    texto: "Os pagamentos do primeiro ao último dia da competência." },
  { nome: "Omissão e inadimplência", formato: "PDF", entrega: "Na hora",
    caminho: ["015-Padaria Central", "2026-09", "Omissão e Inadimplência", "Omissão e Inadimplência 2026-09.pdf"],
    texto: "O relatório completo, com todas as páginas." },
  { nome: "Certidão de débitos", formato: "PDF", entrega: "Na hora",
    caminho: ["015-Padaria Central", "2026-09", "Certidão de Débitos", "Certidão de Débitos 2026-09.pdf"],
    texto: "Emitida com o login do contador." },
  { nome: "Conferência de cartão", formato: "PDF", entrega: "Na hora",
    caminho: ["015-Padaria Central", "2026-09", "Conferência Cartão de Crédito", "Conferência Cartão de Crédito 2026-09.pdf"],
    texto: "O detalhamento por administradora, salvo em PDF. Sem operações no mês, o robô só registra isso." },
  { nome: "Dossiê MEI", formato: "Planilha", entrega: "Na hora, só para optante do SIMEI",
    caminho: ["021-Ateliê Ponto Fino", "Dossiê MEI", "Faturamento MEI 2026.xlsx"],
    texto: "Entradas e saídas mês a mês, com notas e cartão acompanhados separados contra o limite do ano." },
];

export default function ServicosInterativos() {
  const [escolhido, setEscolhido] = useState(0);
  const s = SERVICOS[escolhido];
  return (
    <div className="servicos-vivo">
      <ul className="servicos-opcoes" role="listbox" aria-label="Serviços">
        {SERVICOS.map((x, i) => (
          <li key={x.nome}>
            <button type="button" role="option" aria-selected={i === escolhido}
              onClick={() => setEscolhido(i)} onMouseEnter={() => setEscolhido(i)} onFocus={() => setEscolhido(i)}>
              <span>{x.nome}</span><span className="servico-tipo">{x.formato}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="servico-destino" key={escolhido} aria-live="polite">
        <p className="servico-entrega">{s.entrega}</p>
        <h3>{s.nome}</h3>
        <p className="servico-texto">{s.texto}</p>
        <ol className="servico-caminho" aria-label="Onde o arquivo fica">
          <li>Arquivos baixados</li>
          {s.caminho.map((c, i) => (
            <li key={c} style={{ "--i": i + 1 } as React.CSSProperties} className={i === s.caminho.length - 1 ? "arquivo" : ""}>
              {c.includes(" - R$ ") ? <>{c.split(" - R$ ")[0]} - <mark>R$ {c.split(" - R$ ")[1]}</mark></> : c}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
