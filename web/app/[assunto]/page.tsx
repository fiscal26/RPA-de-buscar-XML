import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteTopo from "@/components/site/SiteTopo";
import SiteRodape from "@/components/site/SiteRodape";
import { ASSUNTOS, assuntoPorSlug } from "@/lib/assuntos";
import { SITE_URL } from "@/lib/site";

// Uma página por assunto (lib/assuntos.ts). Endereço fora da lista: página não encontrada.
export const dynamicParams = false;
export function generateStaticParams() {
  return ASSUNTOS.map((a) => ({ assunto: a.slug }));
}

type Props = { params: Promise<{ assunto: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = assuntoPorSlug((await params).assunto);
  if (!a) return {};
  return {
    title: { absolute: `${a.titulo} | LotiVisse` },
    description: a.descricao,
    alternates: { canonical: `/${a.slug}` },
    openGraph: { type: "article", locale: "pt_BR", siteName: "LotiVisse", url: `${SITE_URL}/${a.slug}`, title: a.titulo, description: a.descricao },
  };
}

export default async function PaginaAssunto({ params }: Props) {
  const a = assuntoPorSlug((await params).assunto);
  if (!a) notFound();
  const outros = ASSUNTOS.filter((x) => x.slug !== a.slug);
  const dados = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "LotiVisse", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: a.menu, item: `${SITE_URL}/${a.slug}` },
      ] },
      { "@type": "FAQPage", mainEntity: a.perguntas.map(([p, r]) => ({ "@type": "Question", name: p, acceptedAnswer: { "@type": "Answer", text: r } })) },
    ],
  };

  return (
    <div className="site">
      <SiteTopo />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dados) }} />
      <main className="assunto">
        <nav className="trilha" aria-label="Você está em">
          <Link href="/">Início</Link><span aria-hidden="true">/</span><span>{a.menu}</span>
        </nav>
        <header className="assunto-cabeca">
          <h1>{a.h1}</h1>
          <p className="assunto-abertura">{a.abertura}</p>
          <div className="acoes">
            <Link href="/login" className="botao grande">Entrar no portal</Link>
            <a href={a.planilha.href} className="botao secundario grande" download>{a.planilha.texto}</a>
          </div>
        </header>

        <div className="assunto-corpo">
          {a.blocos.map((b) => (
            <section key={b.titulo} className="assunto-bloco">
              <h2>{b.titulo}</h2>
              {b.texto && <p>{b.texto}</p>}
              {b.lista && <ul>{b.lista.map((item) => <li key={item}>{item}</li>)}</ul>}
            </section>
          ))}
        </div>

        <section className="assunto-bloco" aria-labelledby="perguntas-assunto">
          <h2 id="perguntas-assunto">Perguntas frequentes</h2>
          <div className="perguntas">
            {a.perguntas.map(([p, r]) => <details key={p}><summary>{p}</summary><p>{r}</p></details>)}
          </div>
        </section>

        <section className="assunto-bloco" aria-labelledby="outros-assuntos">
          <h2 id="outros-assuntos">Outros serviços</h2>
          <ul className="assuntos-lista">
            {outros.map((x) => <li key={x.slug}><Link href={`/${x.slug}`}><b>{x.menu}</b><span>{x.descricao}</span></Link></li>)}
          </ul>
        </section>
      </main>

      <section className="chamada">
        <h2>Comece pela planilha modelo.</h2>
        <p>Preencha as empresas do escritório e agende a primeira competência no portal.</p>
        <div className="acoes">
          <a href={a.planilha.href} className="botao grande claro" download>{a.planilha.texto}</a>
          <Link href="/login" className="botao grande contorno-claro">Entrar no portal</Link>
        </div>
      </section>
      <SiteRodape />
    </div>
  );
}
