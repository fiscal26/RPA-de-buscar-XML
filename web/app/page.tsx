import Link from "next/link";
import Logo from "@/components/Logo";
import ArvorePastas from "@/components/ArvorePastas";

const PLANILHA = "/modelos/modelo_empresas_sefaz_pb.xlsx";

// O que o robô busca, separado pelo jeito que o ATF entrega
const POR_MENSAGEM = [
  ["NF-e de saída", "Notas em que a empresa é a emitente."],
  ["NF-e de entrada", "Notas em que a empresa é a destinatária."],
  ["NFC-e", "Cupons emitidos pela empresa."],
  ["CT-e", "Como remetente e como destinatária, em pastas separadas."],
];
const NA_HORA = [
  ["Faturas", "DAR/PIX dos lançamentos em aberto, menos os que o ATF não emite."],
  ["Extrato de pagamentos", "Do primeiro ao último dia da competência."],
  ["Omissão e inadimplência", "O relatório completo, com todas as páginas."],
  ["Certidão de débitos", "Emitida com o login do contador."],
  ["Conferência de cartão", "O detalhamento por administradora, salvo em PDF."],
];
const PASSOS = [
  ["Preencha a planilha modelo", "Inscrição estadual, nome e o login do contador no ATF. Os serviços já vêm marcados com X; apague o que não quiser."],
  ["Agende no portal", "Escolha a competência e se o robô começa agora ou numa data e hora marcadas."],
  ["O robô trabalha no ATF", "No computador do escritório, ele entra com o login do contador, consulta empresa por empresa e recolhe as respostas em Minhas Mensagens."],
  ["Confira as pastas", "Cada empresa ganha a sua pasta por competência, e o portal mostra o que foi salvo, o que veio sem movimento e o que precisa de atenção."],
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
            <a href="#mei">Dossiê MEI</a>
            <a href="#seguranca">Segurança</a>
          </nav>
          <Link href="/login" className="botao">Entrar</Link>
        </div>
      </header>

      <main>
        <section className="heroi">
          <div className="heroi-texto">
            <h1>O ATF da SEFAZ-PB, empresa por empresa, sem ninguém precisar clicar.</h1>
            <p className="heroi-sub">
              Você envia a planilha das empresas. O robô entra no ATF com o login do contador, busca notas, CT-e,
              faturas, extratos e certidões de cada inscrição estadual e guarda tudo na pasta certa.
            </p>
            <div className="acoes">
              <Link href="/login" className="botao grande">Entrar no portal</Link>
              <a href={PLANILHA} className="botao secundario grande" download>Baixar a planilha modelo</a>
            </div>
          </div>
          <ArvorePastas />
        </section>

        <section id="servicos" className="secao">
          <div className="secao-cabeca">
            <h2>O que o robô busca</h2>
            <p>Uma coluna na planilha para cada serviço. O ATF entrega uns por mensagem e outros na hora; o robô cuida dos dois.</p>
          </div>
          <div className="servicos">
            <div>
              <h3>XML, por Minhas Mensagens</h3>
              <p className="servicos-nota">O ATF responde minutos depois. O robô lê a caixa, baixa só o anexo e entrega cada XML à empresa dona dele.</p>
              <dl className="lista-servicos">
                {POR_MENSAGEM.map(([n, d]) => (<div key={n}><dt>{n}</dt><dd>{d}</dd></div>))}
              </dl>
            </div>
            <div>
              <h3>PDF, na hora</h3>
              <p className="servicos-nota">O arquivo sai na mesma consulta e vai para a pasta do serviço, na competência.</p>
              <dl className="lista-servicos">
                {NA_HORA.map(([n, d]) => (<div key={n}><dt>{n}</dt><dd>{d}</dd></div>))}
              </dl>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="secao">
          <div className="secao-cabeca">
            <h2>Como funciona</h2>
          </div>
          <ol className="passos">
            {PASSOS.map(([t, d]) => (<li key={t}><h3>{t}</h3><p>{d}</p></li>))}
          </ol>
        </section>

        <section id="mei" className="secao mei">
          <div className="secao-cabeca">
            <h2>Dossiê MEI: o faturamento do ano, mês a mês</h2>
            <p>
              Para quem é optante do SIMEI, o robô lê as entradas e saídas do dossiê do contribuinte e acompanha
              notas e cartão separados, porque as vendas no cartão podem estar dentro das notas ou não.
              O cliente que chega sem acompanhamento já sai com o ano todo.
            </p>
          </div>
          <div className="mei-exemplo" aria-label="Exemplo: Ateliê Ponto Fino, acumulado até setembro de 2026">
            <p className="mei-empresa">Ateliê Ponto Fino <span>acumulado até 09/2026, limite de R$ 81.000,00</span></p>
            <Barra rotulo="Notas" valor="R$ 46.300,00" pct={57.2} />
            <Barra rotulo="Cartão" valor="R$ 61.900,00" pct={76.4} />
            <div className="mei-escala" aria-hidden="true"><span style={{ left: `${100 / 1.3}%` }}>limite</span><span style={{ left: `${120 / 1.3}%` }}>+20%</span></div>
            <p className="mei-nota">
              Até 20% acima do limite, o desenquadramento vale a partir do ano seguinte; acima disso, retroage a janeiro
              (LC 123/2006, art. 18-A). No ano de abertura, o limite é de R$ 6.750,00 por mês de atividade.
            </p>
          </div>
        </section>

        <section id="seguranca" className="secao">
          <div className="secao-cabeca">
            <h2>A senha do contador continua só do contador</h2>
          </div>
          <div className="colunas">
            <div>
              <h3>Cifrada no envio</h3>
              <p>O portal cifra a senha do ATF assim que lê a planilha. No banco fica só a versão cifrada, que nem o portal consegue abrir.</p>
            </div>
            <div>
              <h3>O robô roda no escritório</h3>
              <p>A chave que abre a senha fica no computador onde o robô trabalha, com o Chrome do próprio escritório.</p>
            </div>
            <div>
              <h3>Nada de tentativa repetida</h3>
              <p>Se o ATF recusar um login, o robô não tenta de novo nas outras empresas, para não bloquear o acesso.</p>
            </div>
          </div>
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
        <div className="site-faixa">
          <Logo />
          <p>lotivisse.com.br</p>
          <p className="rodape-aviso">SEFAZ-PB e ATF são sistemas do Governo da Paraíba. A LotiVisse não tem vínculo com a Secretaria da Fazenda.</p>
        </div>
      </footer>
    </div>
  );
}

function Barra({ rotulo, valor, pct }: { rotulo: string; valor: string; pct: number }) {
  return (
    <div className="barra">
      <span className="barra-rotulo">{rotulo}</span>
      <span className="barra-trilho" role="img" aria-label={`${rotulo}: ${valor}, ${pct.toLocaleString("pt-BR")}% do limite`}>
        <span className="barra-valor" style={{ width: `${pct / 1.3}%` }} />
      </span>
      <span className="barra-num">{valor} <small>{pct.toLocaleString("pt-BR")}%</small></span>
    </div>
  );
}
