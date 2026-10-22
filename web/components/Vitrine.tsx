import Logo from "./Logo";
import Robo from "./Robo";

const LINHAS = [
  ["X", "16.012.345-3", "Padaria Central", "X", "X", "X"],
  ["X", "16.098.765-2", "Mercado Sol", "X", "", "X"],
  ["X", "16.170.090-0", "Ateliê Ponto Fino", "X", "X", ""],
];

/** Lado escuro do login: a planilha entra, o robô busca no ATF e as pastas saem prontas. */
export default function Vitrine() {
  return (
    <aside className="vitrine">
      <Logo />
      <div className="vitrine-texto">
        <h2>Os documentos da SEFAZ-PB chegam sozinhos.</h2>
        <p>Você envia a planilha das empresas. O robô entra no ATF com o login do contador e guarda notas, guias e certidões na pasta de cada empresa.</p>
      </div>
      <div className="vitrine-cena" aria-hidden="true">
        <div className="mini-planilha">
          <table>
            <thead><tr><th>ATIVA</th><th>INSCRIÇÃO</th><th>NOME</th><th>NF-e</th><th>NFC-e</th><th>CT-e</th></tr></thead>
            <tbody>{LINHAS.map((l) => <tr key={l[1]}>{l.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="mini-robo"><Robo tamanho={132} /></div>
        <div className="mini-pastas">
          <p>015-Padaria Central / 2026-09</p>
          <ul>
            <li>NF-e Saida - <mark>R$ 48.213,90</mark></li>
            <li>NFC-e - <mark>R$ 12.930,15</mark></li>
            <li>Faturas 2026-09.pdf</li>
            <li>Certidão de Débitos 2026-09.pdf</li>
          </ul>
        </div>
      </div>
    </aside>
  );
}
