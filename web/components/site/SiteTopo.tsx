import Link from "next/link";
import Logo from "@/components/Logo";
import BotaoTema from "@/components/BotaoTema";

/** Topo das páginas públicas. Fora da página inicial, os links das seções levam de volta a ela. */
export default function SiteTopo({ inicio = false }: { inicio?: boolean }) {
  const secao = (id: string) => (inicio ? `#${id}` : `/#${id}`);
  return (
    <header className="site-topo">
      <div className="site-faixa">
        <Link href="/" className="marca" aria-label="LotiVisse, início"><Logo /></Link>
        <nav className="site-nav" aria-label="Seções">
          <a href={secao("servicos")}>Serviços</a>
          <a href={secao("como-funciona")}>Como funciona</a>
          <a href={secao("onde-funciona")}>Onde funciona</a>
        </nav>
        <BotaoTema />
        <Link href="/login" className="botao">Entrar</Link>
      </div>
    </header>
  );
}
