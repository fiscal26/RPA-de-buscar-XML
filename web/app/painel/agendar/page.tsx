import Link from "next/link";
import { contexto } from "@/lib/sessao";
import { mesAnterior } from "@/lib/documentos";
import FormAgendamento from "../FormAgendamento";
import FormAgendamentoNfse from "../FormAgendamentoNfse";

export default async function Agendar({ searchParams }: { searchParams: Promise<{ origem?: string }> }) {
  const nfse = (await searchParams).origem === "nfse";
  const { supabase, admin } = await contexto();
  const organizacoes = admin
    ? (await supabase.from("organizacoes").select("id, nome").eq("ativo", true).order("nome")).data ?? []
    : undefined;
  return (
    <>
      <h1>Agendar uma competência</h1>
      <nav className="origens" aria-label="De onde vêm as notas">
        <Link href="/painel/agendar" className="origem" aria-current={nfse ? undefined : "page"}>
          <b>SEFAZ do estado</b>
          <span>NF-e, NFC-e, CT-e, guias, certidões e Dossiê MEI pelo ATF, com o login do contador.</span>
        </Link>
        <Link href="/painel/agendar?origem=nfse" className="origem" aria-current={nfse ? "page" : undefined}>
          <b>Portal Nacional (NFS-e)</b>
          <span>Notas fiscais de serviço emitidas e recebidas, PDF e relatório de retenções, com o certificado A1.</span>
        </Link>
      </nav>
      {nfse ? (
        <div className="passo-form">
          <section className="cartao">
            <h2 className="titulo-cartao">Antes de enviar</h2>
            <ol className="preparo">
              <li>Envie o certificado A1 de cada empresa em <Link href="/painel/certificados">Certificados</Link> (o da matriz serve às filiais).</li>
              <li>Baixe a planilha modelo da NFS-e e preencha uma empresa por linha: CNPJ e nome.</li>
              <li>Apague o X dos serviços de que a empresa não precisa.</li>
            </ol>
            <a className="botao" href="/modelos/modelo_empresas_nfse.xlsx" download>Baixar a planilha modelo da NFS-e</a>
            <details className="duvidas">
              <summary>Dúvidas comuns</summary>
              <dl>
                <dt>Por que o certificado?</dt>
                <dd>É o acesso da API oficial do Portal Nacional: baixa as notas em lote, sem captcha e sem custo.</dd>
                <dt>Quais notas vêm?</dt>
                <dd>As emitidas pela empresa e as recebidas (em que ela é a tomadora), da competência escolhida. As canceladas ficam de fora.</dd>
                <dt>O que tem no relatório de retenções?</dt>
                <dd>Uma linha por nota com ISS retido, IRRF, PIS, COFINS, CSLL e INSS, e os totais de emitidas e recebidas.</dd>
                <dt>A planilha leva senha?</dt>
                <dd>Não. A senha do certificado é informada só uma vez, em Certificados, e fica cifrada.</dd>
              </dl>
            </details>
          </section>
          <div className="cartao">
            <FormAgendamentoNfse organizacoes={organizacoes} competencia={mesAnterior()} />
          </div>
        </div>
      ) : (
        <div className="passo-form">
          <section className="cartao">
            <h2 className="titulo-cartao">Antes de enviar</h2>
            <ol className="preparo">
              <li>Baixe a planilha modelo.</li>
              <li>Preencha uma empresa por linha: inscrição estadual, nome, login e senha do ATF.</li>
              <li>Apague o X dos serviços de que a empresa não precisa.</li>
            </ol>
            <a className="botao" href="/modelos/modelo_empresas_sefaz_pb.xlsx" download>Baixar a planilha modelo</a>
            <details className="duvidas">
              <summary>Dúvidas comuns</summary>
              <dl>
                <dt>Preciso mandar a senha toda vez?</dt>
                <dd>Não. Depois da primeira vez, a senha daquele login pode ficar em branco.</dd>
                <dt>Como deixo uma empresa de fora?</dt>
                <dd>Troque o X da coluna ATIVA por N.</dd>
                <dt>Quanto tempo demora?</dt>
                <dd>Os PDFs saem na hora. Os XMLs chegam pelo ATF em alguns minutos.</dd>
                <dt>E o Dossiê MEI?</dt>
                <dd>Só é feito para empresas optantes pelo SIMEI.</dd>
                <dt>E a planilha depois de enviar?</dt>
                <dd>Apague-a do computador: ela contém as senhas. No portal elas ficam cifradas.</dd>
              </dl>
            </details>
          </section>
          <div className="cartao">
            <FormAgendamento organizacoes={organizacoes} competencia={mesAnterior()} />
          </div>
        </div>
      )}
    </>
  );
}
