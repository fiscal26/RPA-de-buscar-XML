import Link from "next/link";
import Simbolo from "@/components/Simbolo";
import { ASSUNTOS } from "@/lib/assuntos";

/** Rodapé das páginas públicas, com os links para as páginas de cada assunto. */
export default function SiteRodape() {
  return (
    <footer className="rodape">
      <div className="site-faixa rodape-linha">
        <nav className="rodape-assuntos" aria-label="Assuntos">
          {ASSUNTOS.map((a) => <Link key={a.slug} href={`/${a.slug}`}>{a.menu}</Link>)}
        </nav>
        <p>lotivisse.com.br</p>
        <p className="rodape-aviso">SEFAZ, ATF, o Portal Nacional da NFS-e e os portais das prefeituras são sistemas dos governos federal, estaduais e municipais. A LotiVisse não tem vínculo com esses órgãos.</p>
      </div>
      <p className="marca-gigante" aria-hidden="true"><Simbolo tamanho={120} /><span>Loti<span className="logo-v">Visse</span></span></p>
    </footer>
  );
}
