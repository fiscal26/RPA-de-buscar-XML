import Link from "next/link";
import { DESCRICAO, SITE_URL } from "@/lib/site";
import Logo from "@/components/Logo";
import Simbolo from "@/components/Simbolo";
import AtfAoVivo from "@/components/AtfAoVivo";
import ServicosInterativos from "@/components/ServicosInterativos";
import BotaoTema from "@/components/BotaoTema";

const PLANILHA = "/modelos/modelo_empresas_sefaz_pb.xlsx";

const PASSOS = [
  ["Preencha a planilha", "Inscrição estadual, nome e o login do contador no portal da SEFAZ de cada empresa."],
  ["Agende a competência", "No portal, agora ou numa data e hora marcadas."],
  ["Receba as pastas", "O robô baixa as notas na SEFAZ e guarda tudo por empresa e competência. A senha vai cifrada e só ele abre."],
];

// Perguntas que as pessoas fazem no Google (texto visível e também nos dados estruturados)
const PERGUNTAS: [string, string][] = [
  ["O que é um robô para baixar notas fiscais?",
    "É um programa que entra no portal da SEFAZ com o login do contador, pede as notas de cada empresa e baixa os XMLs sozinho. Na LotiVisse, você envia a planilha das empresas e recebe tudo organizado em pastas por empresa e competência."],
  ["Quais XMLs e documentos o robô captura?",
    "NF-e de saída e de entrada, NFC-e e CT-e (como remetente e como destinatário), além de faturas, extrato de pagamentos, omissão e inadimplência, certidão de débitos, conferência do cartão de crédito e o faturamento dos MEIs."],
  ["Funciona em quais estados?",
    "Hoje na SEFAZ da Paraíba (ATF). A ferramenta é feita para o Brasil todo: novos estados e as notas de serviço (NFS-e) das prefeituras entram conforme a demanda dos escritórios."],
  ["A senha do contador fica segura?",
    "Sim. A senha é cifrada no navegador antes de ser guardada, e só o robô consegue abri-la. Nem o portal enxerga a senha."],
  ["O robô acompanha o limite de faturamento do MEI?",
    "Sim. O Monitoramento de Faturamento MEI mostra notas, cartão e compras no ano contra os limites e avisa a equipe do escritório por e-mail quando um MEI chega perto ou passa do limite."],
];

// Para o Google entender o que é o site (busca e painel de informações)
const DADOS_ESTRUTURADOS = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: "LotiVisse", url: SITE_URL, logo: `${SITE_URL}/icon.svg` },
    { "@type": "WebSite", "@id": `${SITE_URL}/#site`, name: "LotiVisse", url: SITE_URL, inLanguage: "pt-BR", publisher: { "@id": `${SITE_URL}/#org` } },
    { "@type": "SoftwareApplication", name: "LotiVisse XML", applicationCategory: "BusinessApplication", operatingSystem: "Web",
      url: SITE_URL, description: DESCRICAO, inLanguage: "pt-BR", areaServed: { "@type": "Country", name: "Brasil" },
      publisher: { "@id": `${SITE_URL}/#org` } },
    { "@type": "FAQPage", mainEntity: PERGUNTAS.map(([p, r]) => ({ "@type": "Question", name: p, acceptedAnswer: { "@type": "Answer", text: r } })) },
  ],
};

export default function Inicio() {
  return (
    <div className="site">
      <header className="site-topo">
        <div className="site-faixa">
          <Link href="/" className="marca" aria-label="LotiVisse, início"><Logo /></Link>
          <nav className="site-nav" aria-label="Seções">
            <a href="#servicos">Serviços</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#onde-funciona">Onde funciona</a>
          </nav>
          <BotaoTema />
          <Link href="/login" className="botao">Entrar</Link>
        </div>
      </header>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(DADOS_ESTRUTURADOS) }} />
      <main>
        <section className="heroi">
          <div className="heroi-texto">
            <h1>O robô que baixa as notas fiscais e captura os XMLs, empresa por empresa.</h1>
            <p className="heroi-sub">
              Envie a planilha das empresas. O robô entra na SEFAZ com o login do contador, captura os XMLs de NF-e, NFC-e e CT-e, guias e certidões, e guarda tudo na pasta certa, sem ninguém precisar clicar.
            </p>
            <div className="acoes">
              <Link href="/login" className="botao grande">Entrar no portal</Link>
              <a href={PLANILHA} className="botao secundario grande" download>Baixar a planilha modelo</a>
            </div>
            <p className="heroi-cobertura"><span className="ponto-vivo" aria-hidden="true" />Já disponível na SEFAZ-PB. Novos estados e prefeituras entram conforme a demanda.</p>
          </div>
          <AtfAoVivo />
        </section>

        <section id="servicos" className="secao">
          <ServicosInterativos />
        </section>

        <section id="como-funciona" className="secao">
          <div className="secao-cabeca">
            <h2>Como funciona</h2>
          </div>
          <ol className="passos">
            {PASSOS.map(([t, d]) => (<li key={t}><h3>{t}</h3><p>{d}</p></li>))}
          </ol>
        </section>

        <section id="onde-funciona" className="secao">
          <div className="secao-cabeca">
            <h2>Onde funciona</h2>
            <p>A LotiVisse é feita para escritórios contábeis de todo o Brasil. Cada SEFAZ e cada prefeitura tem o próprio portal, então o robô entra em um de cada vez, na ordem em que os escritórios pedem.</p>
          </div>
          <div className="cobertura">
            <div className="cobertura-item disponivel">
              <span className="status st-ok">Disponível</span>
              <h3>Paraíba — SEFAZ-PB (ATF)</h3>
              <p>XMLs de NF-e (saída e entrada), NFC-e e CT-e; faturas, extrato de pagamentos, omissão e inadimplência,
                certidão de débitos, conferência do cartão de crédito e o faturamento dos MEIs.</p>
            </div>
            <div className="cobertura-item">
              <span className="status st-neutro">Em expansão</span>
              <h3>Outros estados e prefeituras</h3>
              <p>Novas SEFAZ estaduais e as notas de serviço (NFS-e) das prefeituras entram conforme a demanda. Seu escritório
                atende outro estado ou cidade? Fale com a LotiVisse.</p>
            </div>
          </div>
        </section>

        <section id="perguntas" className="secao">
          <div className="secao-cabeca"><h2>Perguntas frequentes</h2></div>
          <div className="perguntas">
            {PERGUNTAS.map(([p, r]) => (
              <details key={p}><summary>{p}</summary><p>{r}</p></details>
            ))}
          </div>
        </section>

        <section className="chamada">
          <h2>Comece pela planilha modelo.</h2>
          <p>Preencha as empresas do escritório e agende a primeira competência no portal.</p>
          <div className="acoes">
            <a href={PLANILHA} className="botao grande claro" download>Baixar a planilha modelo</a>
            <Link href="/login" className="botao grande contorno-claro">Entrar no portal</Link>
          </div>
        </section>
      </main>

      <footer className="rodape">
        <div className="site-faixa rodape-linha">
          <p>lotivisse.com.br</p>
          <p className="rodape-aviso">SEFAZ, ATF e os portais das prefeituras são sistemas dos governos estaduais e municipais. A LotiVisse não tem vínculo com esses órgãos.</p>
        </div>
        <p className="marca-gigante" aria-hidden="true"><Simbolo tamanho={120} /><span>Loti<span className="logo-v">Visse</span></span></p>
      </footer>
    </div>
  );
}
