import Link from "next/link";
import { contexto } from "@/lib/sessao";
import { dataHoraBR, formatarDocumento, formatarIe } from "@/lib/documentos";
import { certificadoDoCnpj, situacaoValidade, usaProcuracao } from "@/lib/nfse";
import { nomeTipo } from "@/lib/xml";
import { removerEmpresa } from "../actions";
import BotaoRemover from "./BotaoRemover";
import Renomear from "./Renomear";
import FormCadastroMei from "../mei/FormCadastroMei";
import type { CadastroMei } from "@/lib/mei-carteira";

type Empresa = {
  id: string; org_id: string; ie: string; cnpj: string; codigo: string; nome: string; nome_fixo?: boolean; tipos: string[]; atualizado_em: string;
  xml_acessos?: { login: string } | null; organizacoes?: { nome: string } | null;
};
type EmpresaNfse = {
  id: string; org_id: string; cnpj: string; codigo: string; nome: string; nome_fixo?: boolean; tipos: string[];
  organizacoes?: { nome: string } | null;
};
type Acesso = { id: string; login: string; atualizado_em: string };
type Certificado = { org_id: string; cnpj: string; validade: string | null; procurador: boolean };

function Remover({ id, nome, origem }: { id: string; nome: string; origem: "sefaz" | "nfse" }) {
  return (
    <form action={removerEmpresa}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="origem" value={origem} />
      <BotaoRemover apelido={nome} />
    </form>
  );
}

export default async function Empresas() {
  const { supabase, admin, perfil } = await contexto();
  // as senhas e os certificados cifrados nem são lidos aqui (o banco só libera o login, o CNPJ e as datas)
  const [{ data: e }, { data: a }, { data: n }, { data: c }, rMei, rSugestoes] = await Promise.all([
    supabase.from("xml_empresas").select("*, xml_acessos(login), organizacoes(nome)").order("nome"),
    supabase.from("xml_acessos").select("id, login, atualizado_em").order("login"),
    supabase.from("xml_nfse_empresas").select("id, org_id, cnpj, codigo, nome, nome_fixo, tipos, organizacoes(nome)").order("nome"),
    supabase.from("xml_nfse_certificados").select("org_id, cnpj, validade, procurador"),
    supabase.from("xml_mei_cadastros").select("org_id, cnpj, nome, ativo, inicio_atividade, inicio_mei, fim_mei"),
    supabase.from("xml_tarefas").select("org_id, ie").contains("detalhes", { mei_nfse: { detectado_no_xml: true } }).limit(10000),
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

  return (
    <>
      <h1>Empresas cadastradas</h1>
      <p className="suave introducao">
        As empresas entram pela planilha do agendamento, uma lista para a SEFAZ e outra para a NFS-e. Os nomes são corrigidos
        ao entrar (por exemplo, “lidi@ne silv4” vira “Lidiane Silva”); o nome renomeado aqui não muda mais com a planilha.
      </p>

      {(admin || perfil.papel === "gestor") && <section className="cartao" id="cadastro-mei">
        <h2 className="titulo-cartao">Cadastro de MEI</h2>
        <p className="suave">Inclua prestadoras no Monitoramento MEI mesmo sem inscrição estadual ou notas emitidas.
          Escolha uma empresa cadastrada abaixo para marcar ou editar o enquadramento.</p>
        {rMei.error ? <p className="faixa alerta">O cadastro MEI ficará disponível após a atualização do banco.</p>
          : opcoesMei.length ? <FormCadastroMei empresas={opcoesMei} cadastros={cadastros} />
          : <p className="suave">Cadastre primeiro uma empresa com CNPJ por um agendamento da SEFAZ ou da NFS-e.</p>}
      </section>}

      <section className="cartao">
        <div className="cartao-topo">
          <h2 className="titulo-cartao">SEFAZ do estado</h2>
          <span className="suave">{empresas.length} {empresas.length === 1 ? "empresa" : "empresas"}</span>
        </div>
        <p className="suave">
          Para trocar a senha de um login do ATF, envie a planilha com a senha nova nesse login: vale para todas as empresas
          dele. As senhas ficam cifradas e não aparecem no portal.
        </p>
        {!!acessos.length && (
          <p>
            <b>Logins do ATF:</b>{" "}
            {acessos.map((x) => `${x.login} (senha de ${dataHoraBR(x.atualizado_em)})`).join("; ")}
          </p>
        )}
        {!empresas.length ? (
          <p className="suave">Nenhuma empresa da SEFAZ ainda. <Link href="/painel/agendar">Agendar com a planilha da SEFAZ</Link>.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>
                  {admin && <th>Organização</th>}
                  <th>ID</th><th>Nome fantasia</th><th>Inscrição estadual</th><th>CNPJ</th><th>Login ATF</th><th>Serviços</th><th></th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((x) => (
                  <tr key={x.id}>
                    {admin && <td>{x.organizacoes?.nome}</td>}
                    <td>{x.codigo}</td>
                    <td className="nome-empresa"><Renomear id={x.id} nome={x.nome} fixo={!!x.nome_fixo} /></td>
                    <td className="doc">{formatarIe(x.ie)}</td>
                    <td className="doc">{formatarDocumento(x.cnpj)}</td>
                    <td>{x.xml_acessos?.login ?? <span className="suave">removido</span>}</td>
                    <td className="servicos">{x.tipos.map(nomeTipo).join(", ")}</td>
                    <td><Remover id={x.id} nome={x.nome} origem="sefaz" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cartao">
        <div className="cartao-topo">
          <h2 className="titulo-cartao">NFS-e (Portal Nacional)</h2>
          <span className="suave">{empresasNfse.length} {empresasNfse.length === 1 ? "empresa" : "empresas"}</span>
        </div>
        <p className="suave">
          O acesso é um certificado A1 enviado em <Link href="/painel/certificados">Certificados</Link>: o da empresa, o da
          matriz (para as filiais) ou o do escritório (para as empresas que deram procuração no e-CAC). A coluna
          Certificado mostra qual o robô vai usar.
        </p>
        {!empresasNfse.length ? (
          <p className="suave">Nenhuma empresa da NFS-e ainda. <Link href="/painel/agendar?origem=nfse">Agendar com a planilha da NFS-e</Link>.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr>{admin && <th>Organização</th>}<th>ID</th><th>Nome</th><th>CNPJ</th><th>Certificado</th><th>Serviços</th><th></th></tr>
              </thead>
              <tbody>
                {empresasNfse.map((x) => {
                  const cert = certificadoDoCnpj(x.cnpj, certificados.filter((k) => k.org_id === x.org_id));
                  const s = cert ? situacaoValidade(cert.validade) : null;
                  return (
                    <tr key={x.id}>
                      {admin && <td>{x.organizacoes?.nome}</td>}
                      <td>{x.codigo}</td>
                      <td className="nome-empresa"><Renomear id={x.id} nome={x.nome} fixo={!!x.nome_fixo} origem="nfse" /></td>
                      <td className="doc">{formatarDocumento(x.cnpj)}</td>
                      <td>
                        {!cert || !s ? <Link href="/painel/certificados" className="status st-erro">Falta o certificado</Link> : (
                          <span className={`status ${s.classe}`}>
                            {cert.cnpj === x.cnpj ? "Próprio" : usaProcuracao(x.cnpj, cert) ? "Do escritório (procuração)" : "Da matriz"}{s.classe !== "st-ok" && `, ${s.nome.toLowerCase()}`}
                          </span>
                        )}
                      </td>
                      <td className="servicos">{x.tipos.map(nomeTipo).join(", ")}</td>
                      <td><Remover id={x.id} nome={x.nome} origem="nfse" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
