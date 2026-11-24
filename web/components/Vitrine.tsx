import Icone from "./Icones";

export default function Vitrine() {
  return (
    <aside className="vitrine" aria-labelledby="vitrine-titulo">
      <div className="vitrine-texto">
        <h2 id="vitrine-titulo">Consultas fiscais por competência</h2>
        <p>Consulte a SEFAZ e o Portal Nacional da NFS-e e acompanhe a entrega de documentos do seu escritório.</p>
      </div>
      <ul className="vitrine-fluxo">
        <li><Icone nome="empresas" /><div><b>Empresas</b><span>Selecione no cadastro ou importe uma planilha.</span></div></li>
        <li><Icone nome="agendar" /><div><b>Agendamentos</b><span>Escolha a competência e acompanhe a execução.</span></div></li>
        <li><Icone nome="arquivo" /><div><b>Documentos</b><span>Receba os arquivos nas pastas de cada empresa.</span></div></li>
      </ul>
    </aside>
  );
}
