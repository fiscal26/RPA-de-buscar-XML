import Link from "next/link";
import Logo from "@/components/Logo";
import Icone from "@/components/Icones";
import MenuLateral from "@/components/MenuLateral";
import { contexto } from "@/lib/sessao";
import { sair } from "@/app/login/actions";

const ITENS = [
  { href: "/painel", nome: "Início", icone: "inicio" },
  { href: "/painel/agendar", nome: "Agendar", icone: "agendar" },
  { href: "/painel/agendamentos", nome: "Agendamentos", icone: "agendamentos" },
  { href: "/painel/empresas", nome: "Empresas", icone: "empresas" },
];

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const { perfil, org, admin } = await contexto();
  const gerencia = admin || perfil.papel === "gestor";
  const nome = perfil.nome || perfil.email;
  return (
    <div className="painel-moldura">
      <header className="barra">
        <Link href="/painel" className="marca marca-clara" aria-label="LotiVisse, início do painel"><Logo /></Link>
        <div className="barra-usuario">
          <span className="avatar" aria-hidden="true">{nome.slice(0, 1).toUpperCase()}</span>
          <span className="barra-nome">
            {nome}
            <small>{admin ? "Administrador" : org?.nome}</small>
          </span>
          <form action={sair}>
            <button type="submit" className="botao-icone" aria-label="Sair" title="Sair"><Icone nome="sair" /></button>
          </form>
        </div>
      </header>
      <MenuLateral itens={ITENS} extras={gerencia ? [{ href: "/painel/equipe", nome: "Equipe", icone: "equipe" }] : []} />
      <main className="painel">
        {org && !org.ativo && <div className="faixa erro">Acesso suspenso. Fale com o responsável pelo site.</div>}
        {children}
      </main>
    </div>
  );
}
