import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import MenuPerfil from "@/components/MenuPerfil";
import MenuLateral from "@/components/MenuLateral";
import Inatividade from "@/components/Inatividade";
import { contexto } from "@/lib/sessao";

export const metadata: Metadata = { title: "Painel", robots: { index: false, follow: false } };

const ITENS = [
  { href: "/painel", nome: "Início", icone: "inicio" },
  { href: "/painel/agendar", nome: "Agendar", icone: "agendar" },
  { href: "/painel/agendamentos", nome: "Agendamentos", icone: "agendamentos" },
  { href: "/painel/empresas", nome: "Empresas", icone: "empresas" },
  { href: "/painel/mei", nome: "Monitoramento MEI", icone: "mei" },
];

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const { perfil, org, admin } = await contexto();
  const gerencia = admin || perfil.papel === "gestor";
  const nome = perfil.nome || perfil.email;
  return (
    <div className="painel-moldura">
      <header className="barra">
        <Link href="/painel" className="marca marca-clara" aria-label="LotiVisse, início do painel"><Logo /></Link>
        <MenuPerfil nome={nome} detalhe={admin ? "Administrador" : org?.nome} />
      </header>
      <MenuLateral itens={ITENS} extras={gerencia ? [{ href: "/painel/equipe", nome: "Equipe", icone: "equipe" }] : []} />
      <main className="painel">
        {org && !org.ativo && <div className="faixa erro">Acesso suspenso. Fale com o responsável pelo site.</div>}
        {children}
      </main>
      <Inatividade />
    </div>
  );
}
