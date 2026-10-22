import Link from "next/link";
import Logo from "./Logo";
import Vitrine from "./Vitrine";
import BotaoTema from "./BotaoTema";

/** Moldura das telas de acesso (login, esqueci a senha, senha nova): formulário à esquerda, vitrine à direita. */
export default function Entrada({ children }: { children: React.ReactNode }) {
  return (
    <div className="entrada">
      <section className="entrada-form">
        <div className="entrada-topo">
          <Link href="/" className="marca" aria-label="LotiVisse, início"><Logo grande /></Link>
          <BotaoTema />
        </div>
        <div className="entrada-conteudo">{children}</div>
        <p className="entrada-rodape">O acesso é criado pela equipe LotiVisse ou pelo gestor do seu escritório.</p>
      </section>
      <Vitrine />
    </div>
  );
}
