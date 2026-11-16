import Link from "next/link";
import { contexto } from "@/lib/sessao";
import { dataBR, dataHoraBR } from "@/lib/documentos";
import { certificadoDoCnpj, situacaoValidade, usaProcuracao } from "@/lib/nfse";
import { nomeTipo } from "@/lib/xml";
import ListaEmpresas from "./ListaEmpresas";
import { agruparEmpresas, type LinhaEmpresa } from "@/lib/empresas";
import FormCadastroMei from "../mei/FormCadastroMei";
import { schemaMeiAusente, lerTodosMei, type DecisaoMei } from "@/lib/mei-acompanhamento";
import type { CadastroMei } from "@/lib/mei-carteira";

type Empresa = {
  id: string; org_id: string; ie: string; cnpj: string; codigo: string; nome: string; nome_fixo?: boolean; tipos: string[];
  xml_acessos?: { login: string } | null; organizacoes?: { nome: string } | null;
};
type EmpresaNfse = Omit<Empresa, "ie" | "xml_acessos">;
type Acesso = { id: string; login: string; atualizado_em: string };
type Certificado = { org_id: string; cnpj: string; validade: string | null; procurador: boolean };

export default async function Empresas({ searchParams }: { searchParams: Promise<{ mei?: string }> }) {
  const solicitada = (await searchParams).mei;
  const { supabase, admin, perfil } = await contexto();
  // Senhas e certificados cifrados não são lidos nesta tela.
  const [{ data: e }, { data: a }, { data: n }, { data: c }, rMei, rSugestoes, rDecisoes] = await Promise.all([
    supabase.from("xml_empresas").select("*, xml_acessos(login), organizacoes(nome)").order("nome"),
    supabase.from("xml_acessos").select("id, login, atualizado_em").order("login"),
    supabase.from("xml_nfse_empresas").select("id, org_id, cnpj, codigo, nome, nome_fixo, tipos, organizacoes(nome)").order("nome"),
    supabase.from("xml_nfse_certificados").select("org_id, cnpj, validade, procurador"),
    supabase.from("xml_mei_cadastros").select("org_id, cnpj, nome, ativo, inicio_atividade, inicio_mei, fim_mei"),
    supabase.from("xml_tarefas").select("org_id, ie").contains("detalhes", { mei_nfse: { detectado_no_xml: true } }).limit(10000),
    lerTodosMei<DecisaoMei>(supabase.from("xml_mei_acompanhamento").select("org_id,cnpj,estado,origem,motivo,versao").order("org_id").order("cnpj")),
  ]);
  const empresas = (e ?? []) as unknown as Empresa[];
  const acessos = (a ?? []) as Acesso[];
  const empresasNfse = (n ?? []) as unknown as EmpresaNfse[];
  const certificados = (c ?? []) as Certificado[];
  const cadastros = (rMei.data ?? []) as CadastroMei[];
  const opcoesMei = [...new Map([...empresasNfse, ...empresas].filter((x) => /^\d{14}$/.test(x.cnpj))
    .map((x) => [`${x.org_id}|${x.cnpj}`, { org: x.org_id, cnpj: x.cnpj, nome: x.nome,
      escritorio: admin ? x.organizacoes?.nome ?? "" : "",
      sugestao: (rSugestoes.data ?? []).some((t) => t.org_id === x.org_id && t.ie === x.cnpj) }])).values()];
  function situacaoMei(org: string, cnpj: string): LinhaEmpresa["mei"] {
    if (rMei.error || (rDecisoes.error && !schemaMeiAusente(rDecisoes.error))) return "indisponivel";
    const decisao = rDecisoes.data.find((d) => d.org_id === org && d.cnpj === cnpj);
    if (decisao) return decisao.estado;
    const cadastro = cadastros.find((m) => m.org_id === org && m.cnpj === cnpj);
    return cadastro ? cadastro.ativo ? "ativo" : "pausado" : "ausente";
  }
  const linhas: LinhaEmpresa[] = [
    ...empresas.map((x): LinhaEmpresa => ({
      org_id: x.org_id, id: x.id, origem: "sefaz", nome: x.nome, fixo: !!x.nome_fixo, cnpj: x.cnpj, codigo: x.codigo,
      escritorio: admin ? x.organizacoes?.nome ?? "" : "", ie: x.ie, servicos: x.tipos.map(nomeTipo).join(", "),
      acesso: x.xml_acessos?.login ? "Login ATF cadastrado" : "Login removido",
      acessoDetalhe: x.xml_acessos?.login ?? "Atualize a planilha do agendamento", acessoClasse: x.xml_acessos?.login ? "st-neutro" : "st-erro",
      pendencia: !x.xml_acessos?.login, mei: situacaoMei(x.org_id, x.cnpj),
    })),
    ...empresasNfse.map((x): LinhaEmpresa => {
      const cert = certificadoDoCnpj(x.cnpj, certificados.filter((k) => k.org_id === x.org_id));
      const s = cert ? situacaoValidade(cert.validade) : null;
      const tipo = cert ? cert.cnpj === x.cnpj ? "Certificado próprio" : usaProcuracao(x.cnpj, cert) ? "Do escritório (procuração)" : "Certificado da matriz" : "";
      return { org_id: x.org_id, id: x.id, origem: "nfse", nome: x.nome, fixo: !!x.nome_fixo, cnpj: x.cnpj, codigo: x.codigo,
        escritorio: admin ? x.organizacoes?.nome ?? "" : "", servicos: x.tipos.map(nomeTipo).join(", "),
        acesso: s?.nome ?? "Falta o certificado", acessoClasse: s?.classe ?? "st-erro",
        acessoDetalhe: cert ? [tipo, cert.validade && `Até ${dataBR(cert.validade)}`].filter(Boolean).join(" · ") : "Envie em Certificados",
        pendencia: !s || s.classe !== "st-ok", mei: situacaoMei(x.org_id, x.cnpj) };
    }),
  ];
  const agrupadas = agruparEmpresas(linhas);
  const empresaInicial = opcoesMei.some((e) => `${e.org}|${e.cnpj}` === solicitada) ? solicitada : undefined;
  return <>
    <header className="empresas-cabecalho">
      <div><h1>Empresas</h1><p className="suave">{agrupadas.length} empresas · SEFAZ e NFS-e</p></div>
      <div className="linha">{(admin || perfil.papel === "gestor") && <Link className="botao secundario" href="/painel/mei/gerenciar">Gerenciar MEIs</Link>}<Link className="botao" href="/painel/agendar">Importar empresas</Link></div>
    </header>
    <ListaEmpresas empresas={agrupadas} />
    {(admin || perfil.papel === "gestor") && <details className="empresas-painel" open={!!empresaInicial}>
      <summary>Cadastro de MEI e consulta CNPJá <span className="suave">Enquadramento e data de abertura</span></summary>
      <div className="empresas-painel-corpo" id="cadastro-mei">
        <h2 className="titulo-cartao">Cadastro de MEI</h2>
        <p className="suave">Inclua prestadoras no Monitoramento MEI mesmo sem inscrição estadual ou notas emitidas.
          Consulte os dados do CNPJ e confirme o enquadramento antes de salvar.</p>
        {rMei.error ? <p className="faixa alerta">O cadastro MEI ficará disponível após a atualização do banco.</p>
          : opcoesMei.length ? <FormCadastroMei key={empresaInicial ?? "cadastro-mei"} empresas={opcoesMei} cadastros={cadastros} empresaInicial={empresaInicial} />
          : <p className="suave">Importe primeiro uma empresa com CNPJ por um agendamento da SEFAZ ou da NFS-e.</p>}
      </div>
    </details>}
    <details className="empresas-painel">
      <summary>Sobre os cadastros e acessos</summary>
      <div className="empresas-painel-corpo suave">
        <p>Cada linha reúne os cadastros do mesmo CNPJ na organização, com as origens SEFAZ e NFS-e.
          Os detalhes e a gestão de cada cadastro ficam no menu de três pontos.
          Os nomes são corrigidos ao importar; um nome renomeado no portal não é substituído pela planilha.</p>
        <p>Para trocar a senha ATF, envie a planilha com a senha nova no agendamento desse login.
          O acesso NFS-e usa o certificado da empresa, da matriz ou do escritório com procuração no e-CAC.
          Gerencie os certificados em <Link href="/painel/certificados">Certificados</Link>.</p>
        {!!acessos.length && <ul>{acessos.map((x) => <li key={x.id}>ATF {x.login} · senha atualizada em {dataHoraBR(x.atualizado_em)}</li>)}</ul>}
        <p>A coluna MEI mostra a decisão de acompanhamento do escritório. Empresas detectadas pelo ATF continuam sendo acompanhadas no <Link href="/painel/mei">Monitoramento MEI</Link>.</p>
      </div>
    </details>
  </>;
}
