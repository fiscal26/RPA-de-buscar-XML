/** A pasta que o robô monta numa competência: é o resultado do produto, mostrado como ele aparece no
 *  Explorador de Arquivos. As linhas entram uma vez, em sequência, como se estivessem sendo salvas. */
type Linha = { nivel: number; nome: string; valor?: string; arquivo?: string; pasta?: boolean };

const LINHAS: Linha[] = [
  { nivel: 0, nome: "Arquivos baixados", pasta: true },
  { nivel: 1, nome: "015-Padaria Central", pasta: true },
  { nivel: 2, nome: "2026-09", pasta: true },
  { nivel: 3, nome: "NF-e Saida", valor: "R$ 48.213,90", arquivo: "NF-e Saida 2026-09.zip", pasta: true },
  { nivel: 3, nome: "NF-e Entrada", valor: "R$ 31.087,44", arquivo: "NF-e Entrada 2026-09.zip", pasta: true },
  { nivel: 3, nome: "NFC-e", valor: "R$ 12.930,15", arquivo: "NFC-e 2026-09.zip", pasta: true },
  { nivel: 3, nome: "CT-e Destinatario", valor: "R$ 1.450,00", arquivo: "CT-e Destinatario 2026-09.zip", pasta: true },
  { nivel: 3, nome: "Faturas", arquivo: "Faturas 2026-09.pdf", pasta: true },
  { nivel: 3, nome: "Certidão de Débitos", arquivo: "Certidão de Débitos 2026-09.pdf", pasta: true },
  { nivel: 1, nome: "021-Ateliê Ponto Fino", pasta: true },
  { nivel: 2, nome: "Dossiê MEI", arquivo: "Faturamento MEI 2026.xlsx", pasta: true },
];

export default function ArvorePastas() {
  return (
    <figure className="arvore" aria-label="Exemplo da pasta montada pelo robô na competência 09/2026">
      <div className="arvore-barra" aria-hidden="true">
        <span>Documentos</span><span>XML SEFAZ-PB</span><span>Arquivos baixados</span>
      </div>
      <ul className="arvore-lista">
        {LINHAS.map((l, i) => (
          <li key={l.nome + i} className="arvore-linha" style={{ "--i": i, "--nivel": l.nivel } as React.CSSProperties}>
            <span className="arvore-pasta">
              <IconePasta />
              {l.nome}
              {l.valor && <> - <mark>{l.valor}</mark></>}
            </span>
            {l.arquivo && <span className="arvore-arquivo">{l.arquivo}</span>}
          </li>
        ))}
      </ul>
      <figcaption>Competência 09/2026. O ZIP fica como veio do ATF; o valor no nome da pasta soma as notas autorizadas, sem as canceladas.</figcaption>
    </figure>
  );
}

function IconePasta() {
  return (
    <svg className="icone-pasta" viewBox="0 0 16 13" aria-hidden="true">
      <path d="M1 2.2C1 1.5 1.5 1 2.2 1h3.6l1.6 1.6h6.4c.7 0 1.2.5 1.2 1.2v7c0 .7-.5 1.2-1.2 1.2H2.2C1.5 12 1 11.5 1 10.8z" />
    </svg>
  );
}
