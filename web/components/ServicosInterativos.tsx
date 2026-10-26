"use client";

import { useState } from "react";

/** O que o robô busca e como fica a pasta: escolher um serviço acende onde ele é guardado. */
type Grupo = "xml" | "pdf" | "mei";  // mei = planilhas (Dossiê MEI e retenções da NFS-e)
const SERVICOS: { id: string; nome: string; grupo: Grupo }[] = [
  { id: "nfe", nome: "NF-e", grupo: "xml" },
  { id: "nfce", nome: "NFC-e", grupo: "xml" },
  { id: "cte", nome: "CT-e", grupo: "xml" },
  { id: "nfse", nome: "NFS-e", grupo: "xml" },
  { id: "faturas", nome: "Faturas", grupo: "pdf" },
  { id: "extrato", nome: "Extrato", grupo: "pdf" },
  { id: "omissao", nome: "Omissão", grupo: "pdf" },
  { id: "certidao", nome: "Certidão", grupo: "pdf" },
  { id: "cartao", nome: "Cartão", grupo: "pdf" },
  { id: "retencoes", nome: "Retenções", grupo: "mei" },
  { id: "mei", nome: "Dossiê MEI", grupo: "mei" },
];

// [nível, texto, de qual serviço é, cor]
const PASTA: [number, string, string, string][] = [
  [0, "015-Padaria Central/", "", "empresa"],
  [1, "2026-09/", "", "mes"],
  [2, "NF-e Saida - R$ 48.213,90/", "nfe", "xml"],
  [2, "NF-e Entrada - R$ 31.087,44/", "nfe", "xml"],
  [2, "NFC-e - R$ 12.930,15/", "nfce", "xml"],
  [2, "CT-e Remetente - R$ 640,00/", "cte", "xml"],
  [2, "CT-e Destinatario - R$ 1.450,00/", "cte", "xml"],
  [2, "NFS-e Emitidas/", "nfse", "xml"],
  [2, "NFS-e Recebidas/", "nfse", "xml"],
  [2, "Retenções NFS-e 2026-09.xlsx", "retencoes", "mei"],
  [2, "Faturas/", "faturas", "pdf"],
  [2, "Extrato de Pagamentos/", "extrato", "pdf"],
  [2, "Omissão e Inadimplência/", "omissao", "pdf"],
  [2, "Certidão de Débitos/", "certidao", "pdf"],
  [2, "Conferência Cartão de Crédito/", "cartao", "pdf"],
  [1, "Dossiê MEI/", "mei", "mei"],
  [2, "Faturamento MEI 2026.xlsx", "mei", "mei"],
];

export default function ServicosInterativos() {
  const [ativo, setAtivo] = useState("");
  return (
    <div className="servicos-pasta">
      <div className="servicos-texto">
        <h2>O que o robô busca e onde guarda</h2>
        <p>
          Uma pasta por empresa e, dentro dela, uma por competência. O XML vem como o portal do governo entregou e o valor
          das notas vai no nome da pasta, pronto para levar ao sistema contábil.
        </p>
        <ul className="etiquetas" aria-label="Serviços">
          {SERVICOS.map((s) => (
            <li key={s.id}>
              <button type="button" className={`etiqueta etiqueta-${s.grupo}`} aria-pressed={ativo === s.id}
                onMouseEnter={() => setAtivo(s.id)} onMouseLeave={() => setAtivo("")}
                onFocus={() => setAtivo(s.id)} onBlur={() => setAtivo("")} onClick={() => setAtivo(ativo === s.id ? "" : s.id)}>
                {s.nome}
              </button>
            </li>
          ))}
        </ul>
        <p className="legenda">
          <span><span className="ponto ponto-xml" />XML e PDF das notas</span>
          <span><span className="ponto ponto-pdf" />Guias e certidões</span>
          <span><span className="ponto ponto-mei" />Planilhas</span>
        </p>
      </div>
      <pre className={`pasta-codigo${ativo ? " focado" : ""}`} aria-label="Estrutura de pastas de uma empresa">
        {PASTA.map(([nivel, texto, servico, cor]) => (
          <span key={texto} className={`pasta-linha cor-${cor}${servico && servico === ativo ? " aceso" : ""}`}
            style={{ "--nivel": nivel } as React.CSSProperties}>{texto}</span>
        ))}
      </pre>
    </div>
  );
}
