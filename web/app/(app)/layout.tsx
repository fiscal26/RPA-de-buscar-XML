import Link from "next/link";
import Logo from "@/components/Logo";
import { contexto } from "@/lib/sessao";
import { sair } from "@/app/login/actions";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const { perfil, org } = await contexto();
  return (
    <>
      <header className="topo">
        <Link href="/" className="marca"><Logo /> <span className="logo-modulo">XML</span></Link>
        <nav>
          <Link href="/">Agendar</Link>
          <Link href="/agendamentos">Agendamentos</Link>
          <Link href="/empresas">Empresas</Link>
        </nav>
        <div className="usuario">
          <span>{perfil.nome || perfil.email}</span>
          {org && <span>· {org.nome}</span>}
          <form action={sair}>
            <button type="submit">Sair</button>
          </form>
        </div>
      </header>
      <main>
        {org && !org.ativo && <div className="faixa erro">Acesso suspenso. Fale com o responsável pelo site.</div>}
        {children}
      </main>
    </>
  );
}
