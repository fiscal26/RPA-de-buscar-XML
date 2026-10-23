import Link from "next/link";
import Logo from "@/components/Logo";
import Simbolo from "@/components/Simbolo";
import AtfAoVivo from "@/components/AtfAoVivo";
import ServicosInterativos from "@/components/ServicosInterativos";
import BotaoTema from "@/components/BotaoTema";

const PLANILHA = "/modelos/modelo_empresas_sefaz_pb.xlsx";

const PASSOS = [
  ["Preencha a planilha", "Inscrição estadual, nome e o login do contador no ATF de cada empresa."],
  ["Agende a competência", "No portal, agora ou numa data e hora marcadas."],
  ["Receba as pastas", "O robô busca no ATF e guarda tudo por empresa e competência. A senha vai cifrada e só ele abre."],
];

export default function Inicio() {
  return (
    <div className="site">
      <header className="site-topo">
        <div className="site-faixa">
          <Link href="/" className="marca" aria-label="LotiVisse, início"><Logo /></Link>
          <nav className="site-nav" aria-label="Seções">
            <a href="#servicos">Serviços</a>
            <a href="#como-funciona">Como funciona</a>
          </nav>
          <BotaoTema />
          <Link href="/login" className="botao">Entrar</Link>
        </div>
      </header>

      <main>
        <section className="heroi">
          <div className="heroi-texto">
            <h1>O ATF da SEFAZ-PB, empresa por empresa, sem ninguém precisar clicar.</h1>
            <p className="heroi-sub">
              Envie a planilha das empresas. O robô busca notas, guias e certidões no ATF e guarda tudo na pasta certa.
            </p>
            <div className="acoes">
              <Link href="/login" className="botao grande">Entrar no portal</Link>
              <a href={PLANILHA} className="botao secundario grande" download>Baixar a planilha modelo</a>
            </div>
          </div>
          <AtfAoVivo />
        </section>

        <section id="servicos" className="secao">
          <ServicosInterativos />
        </section>

        <section id="como-funciona" className="secao">
          <div className="secao-cabeca">
            <h2>Como funciona</h2>
          </div>
          <ol className="passos">
            {PASSOS.map(([t, d]) => (<li key={t}><h3>{t}</h3><p>{d}</p></li>))}
          </ol>
        </section>

        <section className="chamada">
          <h2>Comece pela planilha modelo.</h2>
          <p>Preencha as empresas do escritório e agende a primeira competência no portal.</p>
          <div className="acoes">
            <a href={PLANILHA} className="botao grande claro" download>Baixar a planilha modelo</a>
            <Link href="/login" className="botao grande contorno-claro">Entrar no portal</Link>
          </div>
        </section>
      </main>

      <footer className="rodape">
        <div className="site-faixa rodape-linha">
          <p>lotivisse.com.br</p>
          <p className="rodape-aviso">SEFAZ-PB e ATF são sistemas do Governo da Paraíba. A LotiVisse não tem vínculo com a Secretaria da Fazenda.</p>
        </div>
        <p className="marca-gigante" aria-hidden="true"><Simbolo tamanho={120} /><span>Loti<span className="logo-v">Visse</span></span></p>
      </footer>
    </div>
  );
}
