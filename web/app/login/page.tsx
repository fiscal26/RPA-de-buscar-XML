import Link from "next/link";
import FormLogin from "./FormLogin";
import Logo from "@/components/Logo";

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <div className="entrada">
      <aside className="entrada-lado">
        <Link href="/" className="marca" aria-label="LotiVisse, início"><Logo /></Link>
        <blockquote>Notas, guias e certidões da SEFAZ-PB, cada uma na pasta da sua empresa.</blockquote>
        <p>O acesso ao portal é criado pela equipe LotiVisse.</p>
      </aside>
      <section className="entrada-form">
        <div>
          <h1>Entrar no portal</h1>
          <p className="suave">Use o e-mail e a senha que a LotiVisse enviou para você.</p>
          {erro === "sem-acesso" && <div className="faixa erro">Seu usuário está sem acesso. Fale com o responsável pelo site.</div>}
          <FormLogin />
        </div>
      </section>
    </div>
  );
}
