import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import MenuPerfil from "@/components/MenuPerfil";
import Notificacoes from "@/components/Notificacoes";
import MenuLateral from "@/components/MenuLateral";
import Inatividade from "@/components/Inatividade";
import { contexto } from "@/lib/sessao";

export const metadata: Metadata = { title: "Painel", robots: { index: false, follow: false } };

const GRUPOS = [
  {
    titulo: "Operação",
    itens: [
      { href: "/painel", nome: "Início", icone: "inicio" },
      { href: "/painel/agendar", nome: "Agendar", icone: "agendar" },
      { href: "/painel/agendamentos", nome: "Agendamentos", icone: "agendamentos" },
      { href: "/painel/monitor", nome: "Monitor Fiscal", icone: "monitor" },
    ],
  },
  {
    titulo: "Empresas",
    itens: [
      { href: "/painel/empresas", nome: "Empresas", icone: "empresas" },
      { href: "/painel/certificados", nome: "Certificados", icone: "certificado" },
      { href: "/painel/mei", nome: "Monitoramento MEI", icone: "mei" },
    ],
  },
];

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const { perfil, org, admin } = await contexto();
  const gerencia = admin || perfil.papel === "gestor";
  const grupos = [...GRUPOS, {
    titulo: "Administração",
    itens: gerencia ? [{ href: "/painel/equipe", nome: "Equipe", icone: "equipe" }] : [],
  }];
  const nome = perfil.nome || perfil.email;
  return (
    <div className="painel-moldura">
      <a className="pular-conteudo" href="#conteudo-painel">Pular para o conteúdo</a>
      <header className="barra">
        <Link href="/painel" className="marca marca-clara" aria-label="LotiVisse, início do painel"><Logo /></Link>
        <div className="barra-direita">
          <Notificacoes />
          <MenuPerfil nome={nome} detalhe={admin ? "Administrador" : org?.nome} />
        </div>
      </header>
      <MenuLateral grupos={grupos} />
      <main className="painel" id="conteudo-painel" tabIndex={-1}>
        {org && !org.ativo && <div className="faixa erro">Acesso suspenso. Fale com o responsável pelo site.</div>}
        {children}
      </main>
      <Inatividade />
    </div>
  );
}
