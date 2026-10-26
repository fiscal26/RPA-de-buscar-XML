import Link from "next/link";
import { DESCRICAO, SITE_URL } from "@/lib/site";
import AtfAoVivo from "@/components/AtfAoVivo";
import ServicosInterativos from "@/components/ServicosInterativos";
import SiteTopo from "@/components/site/SiteTopo";
import SiteRodape from "@/components/site/SiteRodape";
import { ASSUNTOS } from "@/lib/assuntos";

const PLANILHA = "/modelos/modelo_empresas_sefaz_pb.xlsx";

const PASSOS = [
  ["Preencha a planilha", "Para a SEFAZ, a inscrição estadual e o login do contador. Para a NFS-e, o CNPJ, com o certificado A1 enviado uma vez no portal."],
  ["Agende a competência", "No portal, agora ou numa data e hora marcadas."],
  ["Receba as pastas", "O robô baixa as notas e guarda tudo por empresa e competência. Senhas e certificados vão cifrados e só ele abre."],
];

// Perguntas que as pessoas fazem no Google (texto visível e também nos dados estruturados)
const PERGUNTAS: [string, string][] = [
  ["O que é um robô para baixar notas fiscais?",
    "É um programa que entra nos portais do governo pelo escritório, pede as notas de cada empresa e baixa os XMLs sozinho. Na LotiVisse, você envia a planilha das empresas e recebe tudo organizado em pastas por empresa e competência."],
  ["Quais XMLs e documentos o robô captura?",
    "Na SEFAZ: NF-e de saída e de entrada, NFC-e e CT-e (como remetente e como destinatário), além de faturas, extrato de pagamentos, omissão e inadimplência, certidão de débitos, conferência do cartão de crédito e o faturamento dos MEIs. No Portal Nacional: as NFS-e emitidas e recebidas, em XML e PDF, com o relatório de retenções."],
  ["Funciona em quais estados?",
    "As notas de serviço (NFS-e) funcionam em todo o Brasil pelo Portal Nacional, nos municípios que usam o padrão nacional. As notas de produto e os documentos da SEFAZ funcionam hoje na Paraíba (ATF); novos estados e prefeituras com portal próprio entram conforme a demanda dos escritórios."],
  ["Como o robô baixa as notas de serviço (NFS-e)?",
    "Pela API oficial do Portal Nacional da NFS-e, com o certificado digital A1 (e-CNPJ) da empresa. Vêm as notas emitidas e as recebidas da competência, sem captcha e sem as canceladas. O certificado da matriz também serve às filiais."],
  ["O que tem no relatório de retenções?",
    "Uma planilha por competência com uma linha por nota: ISS retido, IRRF, PIS, COFINS, CSLL e INSS, total retido e valor líquido, e os totais das notas emitidas (o que os clientes retiveram) e das recebidas (o que a empresa reteve e precisa recolher)."],
  ["A senha do contador e o certificado ficam seguros?",
    "Sim. A senha do portal e o certificado A1 são cifrados antes de serem guardados, e só o robô consegue abri-los. Nem o portal enxerga."],
  ["O robô acompanha o limite de faturamento do MEI?",
    "Sim. O Monitoramento de Faturamento MEI mostra notas, cartão e compras no ano contra os limites e avisa a equipe do escritório por e-mail quando um MEI chega perto ou passa do limite."],
];

// Para o Google entender o que é o site (busca e painel de informações)
const DADOS_ESTRUTURADOS = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: "LotiVisse", url: SITE_URL, logo: `${SITE_URL}/icon.svg`,
      description: DESCRICAO, areaServed: { "@type": "Country", name: "Brasil" },
      knowsAbout: ["download de XML de notas fiscais em lote", "NF-e", "NFC-e", "CT-e", "NFS-e", "Portal Nacional da NFS-e",
        "retenções na NFS-e", "limite de faturamento do MEI", "automação para escritórios de contabilidade"] },
    { "@type": "WebSite", "@id": `${SITE_URL}/#site`, name: "LotiVisse", url: SITE_URL, inLanguage: "pt-BR", publisher: { "@id": `${SITE_URL}/#org` } },
    { "@type": "SoftwareApplication", name: "LotiVisse XML", applicationCategory: "BusinessApplication", operatingSystem: "Web",
      url: SITE_URL, description: DESCRICAO, inLanguage: "pt-BR", areaServed: { "@type": "Country", name: "Brasil" },
      audience: { "@type": "BusinessAudience", name: "Escritórios de contabilidade e departamentos fiscais" },
      featureList: ["Download em lote de XML de NF-e, NFC-e e CT-e pela SEFAZ", "Download em lote de NFS-e emitidas e recebidas pelo Portal Nacional",
        "Relatório de retenções da NFS-e (ISS, IRRF, PIS, COFINS, CSLL e INSS)", "Monitoramento do limite de faturamento do MEI com alertas por e-mail"],
      publisher: { "@id": `${SITE_URL}/#org` } },
    { "@type": "FAQPage", mainEntity: PERGUNTAS.map(([p, r]) => ({ "@type": "Question", name: p, acceptedAnswer: { "@type": "Answer", text: r } })) },
  ],
};

export default function Inicio() {
  return (
    <div className="site">
      <SiteTopo inicio />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(DADOS_ESTRUTURADOS) }} />
      <main>
        <section className="heroi">
          <div className="heroi-texto">
            <h1>O robô que baixa as notas fiscais e captura os XMLs, empresa por empresa.</h1>
            <p className="heroi-sub">
              Envie a planilha das empresas. O robô entra na SEFAZ e no Portal Nacional da NFS-e, captura os XMLs de NF-e, NFC-e, CT-e e NFS-e, guias, certidões e retenções, e guarda tudo na pasta certa, sem ninguém precisar clicar.
            </p>
            <div className="acoes">
              <Link href="/login" className="botao grande">Entrar no portal</Link>
              <a href={PLANILHA} className="botao secundario grande" download>Baixar a planilha modelo</a>
            </div>
            <p className="heroi-cobertura"><span className="ponto-vivo" aria-hidden="true" />NFS-e em todo o Brasil pelo Portal Nacional. Notas da SEFAZ disponíveis na Paraíba; novos estados entram conforme a demanda.</p>
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
            <p>A LotiVisse é feita para escritórios contábeis de todo o Brasil. As notas de serviço vêm do Portal Nacional, que vale
              para o país inteiro; as notas de produto vêm da SEFAZ de cada estado, que entra uma de cada vez, na ordem em que os escritórios pedem.</p>
          </div>
          <div className="cobertura">
            <div className="cobertura-item disponivel">
              <span className="status st-ok">Disponível</span>
              <h3>Brasil, NFS-e pelo Portal Nacional</h3>
              <p>NFS-e emitidas e recebidas em XML e PDF, com o relatório de retenções, nos municípios do padrão nacional.
                O acesso é o certificado A1 da empresa (o da matriz serve às filiais).</p>
            </div>
            <div className="cobertura-item disponivel">
              <span className="status st-ok">Disponível</span>
              <h3>Paraíba, SEFAZ-PB (ATF)</h3>
              <p>XMLs de NF-e (saída e entrada), NFC-e e CT-e; faturas, extrato de pagamentos, omissão e inadimplência,
                certidão de débitos, conferência do cartão de crédito e o faturamento dos MEIs.</p>
            </div>
            <div className="cobertura-item">
              <span className="status st-neutro">Em expansão</span>
              <h3>Outros estados e prefeituras</h3>
              <p>Novas SEFAZ estaduais e as prefeituras que têm portal próprio de NFS-e entram conforme a demanda. Seu escritório
                atende outro estado ou cidade? Fale com a LotiVisse.</p>
            </div>
          </div>
        </section>

        <section id="assuntos" className="secao">
          <div className="secao-cabeca">
            <h2>Para cada rotina do escritório</h2>
            <p>O detalhe de cada serviço: o que vem, como fica e do que o robô precisa.</p>
          </div>
          <ul className="assuntos-lista">
            {ASSUNTOS.map((a) => (
              <li key={a.slug}><Link href={`/${a.slug}`}><b>{a.menu}</b><span>{a.descricao}</span></Link></li>
            ))}
          </ul>
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
          <p>Preencha as empresas do escritório e agende a primeira competência no portal. A planilha da NFS-e fica no Agendar.</p>
          <div className="acoes">
            <a href={PLANILHA} className="botao grande claro" download>Baixar a planilha modelo</a>
            <Link href="/login" className="botao grande contorno-claro">Entrar no portal</Link>
          </div>
        </section>
      </main>

      <SiteRodape />
    </div>
  );
}
