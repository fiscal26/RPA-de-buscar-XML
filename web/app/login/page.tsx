import FormLogin from "./FormLogin";
import Logo from "@/components/Logo";
import { SLOGAN } from "@/lib/marca";

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <div className="login">
      <div className="cartao">
        <h1 className="cabecalho-login"><Logo grande /> <span className="logo-modulo grande">XML</span></h1>
        <p className="suave" style={{ textAlign: "center", marginTop: "-0.5rem" }}>{SLOGAN}</p>
        {erro === "sem-acesso" && <div className="faixa erro">Seu usuário está sem acesso. Fale com o responsável pelo site.</div>}
        <FormLogin />
        <p className="suave" style={{ textAlign: "center", marginTop: "1rem" }}>
          Acesso fornecido pela equipe LotiVisse.
        </p>
      </div>
    </div>
  );
}
