export default function CarregandoPainel() {
  return <div className="painel-carregando" role="status" aria-label="Carregando o painel">
    <span className="sr">Carregando o painel. Aguarde.</span>
    <div aria-hidden="true">
      <div className="esqueleto esqueleto-titulo" />
      <div className="esqueleto esqueleto-faixa" />
      {[1, 2, 3, 4, 5].map((n) => <div key={n} className="esqueleto esqueleto-linha" />)}
    </div>
  </div>;
}
