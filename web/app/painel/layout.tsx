import Link from "next/link";
import Logo from "@/components/Logo";
import NavPainel from "@/components/NavPainel";
import { contexto } from "@/lib/sessao";
import { sair } from "@/app/login/actions";

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const { perfil, org } = await contexto();
  return (
    <>
      <header className="topo">
        <div className="topo-faixa">
          <Link href="/painel" className="marca"><Logo /></Link>
          <NavPainel />
          <div className="usuario">
            <span className="usuario-nome">{perfil.nome || perfil.email}</span>
            {org && <span className="usuario-org">{org.nome}</span>}
            <form action={sair}>
              <button type="submit" className="botao fantasma pequeno">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <main className="painel">
        {org && !org.ativo && <div className="faixa erro">Acesso suspenso. Fale com o responsável pelo site.</div>}
        {children}
      </main>
    </>
  );
}
