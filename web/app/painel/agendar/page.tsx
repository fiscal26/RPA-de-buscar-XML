import Link from "next/link";
import { contexto } from "@/lib/sessao";
import { competenciaBR, mesAnterior } from "@/lib/documentos";
import FormAgendamento from "../FormAgendamento";
import FormAgendamentoNfse from "../FormAgendamentoNfse";
import { lerTodosMei } from "@/lib/mei-acompanhamento";
import type { EmpresaSefazOpcao } from "../FormAgendamento";
import { empresasComCnpj } from "@/lib/cadastro-nfse";

export default async function Agendar({ searchParams }: { searchParams: Promise<{ origem?: string; fonte?: string; org?: string; empresa?: string }> }) {
  const sp = await searchParams;
  const nfse = sp.origem === "nfse";
  const { supabase, admin } = await contexto();
  // última planilha usada (desta origem): o link só aparece quando já houve um agendamento
  const { data: ultimo } = await supabase.from("xml_agendamentos").select("id, competencia")
    .eq("origem", nfse ? "nfse" : "sefaz").order("criado_em", { ascending: false }).limit(1).maybeSingle();
  const ultima = ultimo && (
    <p className="ultima-planilha">
      <a href={`/painel/agendamentos/${ultimo.id}/planilha`} download>Baixar a última planilha usada</a>{" "}
      <span className="suave">(competência {competenciaBR(ultimo.competencia)}, sem as senhas)</span>
    </p>
  );
  const organizacoes = admin
    ? (await supabase.from("organizacoes").select("id, nome").eq("ativo", true).order("nome")).data ?? []
    : undefined;
  // NFS-e: as empresas cadastradas (para marcar) e os certificados (para escolher), sem nada cifrado
  const [empresasNfse, certificadosNfse] = nfse ? await Promise.all([
    empresasComCnpj(supabase).then((l) => l.map(({ org_id, cnpj, nome, codigo }) => ({ org_id, cnpj, nome, codigo }))),
    supabase.from("xml_nfse_certificados").select("id, org_id, nome, cnpj, validade, procurador").order("nome")
      .then(({ data }) => (data ?? []).map((c) => ({ id: c.id as string, org_id: c.org_id as string, nome: (c.nome as string) ?? "",
        cnpj: c.cnpj as string, procurador: !!c.procurador, vencido: !!c.validade && Date.parse(c.validade as string) < Date.now() }))),
  ]) : [[], []];
  const empresasSefaz = nfse ? {data:[],error:null} : await lerTodosMei<EmpresaSefazOpcao>(supabase.from("xml_empresas").select("id,org_id,ie,cnpj,nome,codigo,acesso_id").order("org_id").order("nome").order("id"));
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
          <div className="agendamento-formulario">
            <FormAgendamentoNfse organizacoes={organizacoes} competencia={mesAnterior()} empresas={empresasNfse} certificados={certificadosNfse} fonteInicial={sp.fonte === "cadastro" ? "cadastro" : "planilha"} orgInicial={sp.org} empresaInicial={sp.empresa} />
          </div>
          <section className="agendamento-instrucoes">
            <h2 className="titulo-cartao">Antes de enviar</h2>
            <ol className="preparo">
              <li>Em <Link href="/painel/certificados">Certificados</Link>, envie o A1 da empresa, da matriz ou do escritório, se houver procuração no e-CAC.</li>
              <li>Selecione as empresas cadastradas ou use a planilha modelo. Preencha um CNPJ e nome por linha.</li>
              <li>Na planilha, apague o X dos serviços que não se aplicam.</li>
            </ol>
            <a className="botao secundario" href="/modelos/modelo_empresas_nfse.xlsx" download>Baixar a planilha modelo da NFS-e</a>
            {ultima}
            <details className="duvidas">
              <summary>Dúvidas comuns</summary>
              <dl>
                <dt>Por que o certificado?</dt>
                <dd>É o acesso da API oficial do Portal Nacional: baixa as notas em lote, sem captcha e sem custo.</dd>
                <dt>Preciso do certificado de cada empresa?</dt>
                <dd>Não. Desde novembro de 2026 basta o certificado do escritório (e-CNPJ ou e-CPF do contador), para as empresas que deram procuração eletrônica ao escritório no e-CAC.</dd>
                <dt>Quais notas vêm?</dt>
                <dd>As emitidas pela empresa e as recebidas (em que ela é a tomadora), da competência escolhida. As canceladas ficam de fora.</dd>
                <dt>O que tem no relatório de retenções?</dt>
                <dd>Uma linha por nota com ISS retido, IRRF, PIS, COFINS, CSLL e INSS, e os totais de emitidas e recebidas.</dd>
                <dt>A planilha leva senha?</dt>
                <dd>Não. A senha do certificado é informada só uma vez, em Certificados, e fica cifrada.</dd>
              </dl>
            </details>
          </section>
        </div>
      ) : (
        <div className="passo-form">
          <div className="agendamento-formulario">
            {empresasSefaz.error ? <p className="faixa erro">Não foi possível carregar as empresas cadastradas. Atualize a página.</p> : <FormAgendamento organizacoes={organizacoes} competencia={mesAnterior()} empresas={empresasSefaz.data} fonteInicial={sp.fonte === "cadastro" ? "cadastro" : "planilha"} orgInicial={sp.org} empresaInicial={sp.empresa} />}
          </div>
          <section className="agendamento-instrucoes">
            <h2 className="titulo-cartao">Antes de enviar</h2>
            <ol className="preparo">
              <li>Escolha as empresas já cadastradas ou envie uma planilha.</li>
              <li>Para <Link href="/painel/empresas/nova?origem=sefaz">cadastrar uma empresa</Link>, informe o nome, a IE e o login do ATF.</li>
              <li>Na planilha, apague o X dos serviços que não se aplicam.</li>
            </ol>
            <a className="botao secundario" href="/modelos/modelo_empresas_sefaz_pb.xlsx" download>Baixar a planilha modelo</a>
            {ultima}
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
                <dt>Como reaproveito a planilha do mês passado?</dt>
                <dd>Use "Baixar a última planilha usada": vem com as mesmas empresas e serviços e a senha em branco, que o portal já tem guardada.</dd>
              </dl>
            </details>
          </section>
        </div>
      )}
    </>
  );
}
