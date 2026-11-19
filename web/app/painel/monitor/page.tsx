import Link from "next/link";
import { contexto } from "@/lib/sessao";
import { empresasComCnpj } from "@/lib/cadastro-nfse";
import { situacaoValidade } from "@/lib/nfse";
import { horaBR, somarNotasMonitor, type MonitorLinha } from "@/lib/monitor";
import { carregarResumoMonitor } from "@/lib/monitor-dados";
import AdicionarMonitor from "./AdicionarMonitor";
import HorarioMonitor from "./HorarioMonitor";
import TabelaMonitor, { type LinhaTabela } from "./TabelaMonitor";

type Cert = { org_id: string; cnpj: string; validade: string | null };

export default async function MonitorFiscal() {
  const { supabase, perfil, admin } = await contexto();
  const gerencia = admin || perfil.papel === "gestor";
  const [{ data: m }, { data: c }, porEmpresa, cadastro, organizacoes] = await Promise.all([
    supabase.from("xml_nfe_monitor")
      .select("id, org_id, cnpj, nome, codigo, ciencia, ativo, status, mensagem, proxima_consulta, ultima_consulta, ultima_nota_em, organizacoes(nome)")
      .order("ultima_nota_em", { ascending: false, nullsFirst: false }).order("nome"),
    supabase.from("xml_nfse_certificados").select("org_id, cnpj, validade"),
    carregarResumoMonitor(supabase),
    gerencia ? empresasComCnpj(supabase) : Promise.resolve([]),
    supabase.from("organizacoes").select("id, nome, monitor_hora").eq("ativo", true).order("nome").then((r) => r.data ?? []),
  ]);
  const orgs = (organizacoes ?? []) as { id: string; nome: string; monitor_hora: string | null }[];
  const minhaOrg = orgs.find((o) => o.id === perfil.org_id);
  // o administrador sem escritório próprio configura todos os escritórios de uma vez
  const configOrg = minhaOrg ?? (admin ? orgs[0] : undefined);
  const hora = horaBR(configOrg?.monitor_hora);
  const monitores = (m ?? []) as unknown as MonitorLinha[];
  const certificados = (c ?? []) as Cert[];
  const linhas: LinhaTabela[] = monitores.map((x) => {
    // o Ambiente Nacional só entrega ao próprio CNPJ ou à mesma raiz (matriz/filial): a procuração não vale aqui
    const daRaiz = certificados.filter((k) => k.org_id === x.org_id && k.cnpj.length === 14 && k.cnpj.slice(0, 8) === x.cnpj.slice(0, 8));
    const cert = daRaiz.find((k) => k.cnpj === x.cnpj) ?? daRaiz.find((k) => k.cnpj.slice(8, 12) === "0001") ?? daRaiz[0];
    const s = cert ? situacaoValidade(cert.validade) : null;
    const g = porEmpresa.get(`${x.org_id}:${x.cnpj}`);
    return { ...x, organizacao: x.organizacoes?.nome ?? "", comprasMes: g?.comprasMes ?? 0, notasMes: g?.notasMes ?? 0,
      notasEncontradas: g?.notasEncontradas ?? 0,
      certificado: !cert || !s ? null : { validade: cert.validade, nome: s.nome, classe: s.classe, vencido: s.vencido } };
  });
  const monitorados = new Set(monitores.map((x) => `${x.org_id}:${x.cnpj}`));
  const candidatas = cadastro.filter((e) => !monitorados.has(`${e.org_id}:${e.cnpj}`))
    .map(({ org_id, cnpj, nome, codigo }) => ({ org_id, cnpj, nome, codigo }));

  return (
    <>
      <div className="cabeca-pagina">
        <div>
          <h1>Monitor Fiscal</h1>
          <p className="suave">
            Todo dia, às {hora}, o robô consulta o Ambiente Nacional da NF-e
            e traz as notas destinadas a cada empresa monitorada, de qualquer estado, com o XML e o PDF (DANFE).
          </p>
        </div>
      </div>
      {gerencia && (
        <section className="cartao config-monitor">
          <h2 className="titulo-cartao">Configurações</h2>
          <HorarioMonitor hora={configOrg?.monitor_hora ?? null} />
        </section>
      )}
      {gerencia && <AdicionarMonitor empresas={candidatas} organizacoes={admin ? orgs.map(({ id, nome }) => ({ id, nome })) : undefined} />}

      <TabelaMonitor linhas={linhas} gerencia={gerencia} admin={admin} resumoGeral={somarNotasMonitor([...porEmpresa.values()])}
        clientesMonitorados={monitores.filter((x) => x.ativo).length} vazio={
          <p className="suave">
            Nenhuma empresa no monitoramento ainda.{" "}
            {gerencia ? "Use \"Adicionar ao monitoramento\" e escolha as empresas." : "Peça ao gestor do escritório para incluir as empresas."}{" "}
            Cada uma precisa do certificado A1 dela (ou da matriz) em <Link href="/painel/certificados">Certificados</Link>.
          </p>
        } />
    </>
  );
}
