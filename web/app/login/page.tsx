import type { Metadata } from "next";
import FormLogin from "./FormLogin";
import Entrada from "@/components/Entrada";

export const metadata: Metadata = { title: "Entrar no portal", alternates: { canonical: "/login" } };

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string; senha?: string }> }) {
  const { erro, senha } = await searchParams;
  return (
    <Entrada>
      <h1>Boas-vindas à LotiVisse</h1>
      <p className="entrada-sub">Entre com o e-mail e a senha do seu acesso.</p>
      {erro === "sem-acesso" && <div className="faixa erro">Seu usuário está sem acesso. Fale com o gestor do escritório.</div>}
      {erro === "suspenso" && <div className="faixa erro">O acesso do seu escritório está suspenso. Fale com a LotiVisse.</div>}
      {erro === "link" && <div className="faixa erro">O link de redefinição expirou ou já foi usado. Peça outro em "Esqueci minha senha".</div>}
      {senha === "nova" && <div className="faixa ok">Senha nova salva. Entre com ela.</div>}
      <FormLogin />
    </Entrada>
  );
}
