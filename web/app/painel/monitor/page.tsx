import Link from "next/link";
import Icone from "@/components/Icones";
import { contexto } from "@/lib/sessao";
import { empresasComCnpj } from "@/lib/cadastro-nfse";
import { situacaoValidade } from "@/lib/nfse";
import { UFS, type MonitorLinha } from "@/lib/monitor";
import AdicionarMonitor from "./AdicionarMonitor";
import TabelaMonitor, { type LinhaTabela } from "./TabelaMonitor";

type Cert = { org_id: string; cnpj: string; validade: string | null };
type NotaMes = { org_id: string; cnpj: string; valor: number | null; situacao: string };

const numero = (n: number) => n.toLocaleString("pt-BR");

export default async function MonitorFiscal() {
  const { supabase, perfil, admin } = await contexto();
  const gerencia = admin || perfil.papel === "gestor";
  const agora = new Date();
  const inicioMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1, 3)).toISOString(); // 00h de Brasília
  const [{ data: m }, { data: c }, { data: n }, { count: total }, cadastro, organizacoes] = await Promise.all([
    supabase.from("xml_nfe_monitor")
      .select("id, org_id, cnpj, nome, codigo, ciencia, ativo, status, mensagem, proxima_consulta, ultima_consulta, ultima_nota_em, organizacoes(nome)")
      .order("ultima_nota_em", { ascending: false, nullsFirst: false }).order("nome"),
    supabase.from("xml_nfse_certificados").select("org_id, cnpj, validade"),
    supabase.from("xml_nfe_notas").select("org_id, cnpj, valor, situacao").gte("emissao", inicioMes).limit(20000),
    supabase.from("xml_nfe_notas").select("chave", { count: "exact", head: true }),
    gerencia ? empresasComCnpj(supabase) : Promise.resolve([]),
    admin ? supabase.from("organizacoes").select("id, nome").eq("ativo", true).order("nome").then((r) => r.data ?? []) : Promise.resolve(undefined),
  ]);
  const monitores = (m ?? []) as unknown as MonitorLinha[];
  const certificados = (c ?? []) as Cert[];
  const notasMes = (n ?? []) as NotaMes[];

  const porEmpresa = new Map<string, { qtd: number; valor: number }>();
  for (const x of notasMes) {
    if (x.situacao !== "autorizada") continue;
    const k = `${x.org_id}:${x.cnpj}`;
    const g = porEmpresa.get(k) ?? { qtd: 0, valor: 0 };
    g.qtd++;
    g.valor += Number(x.valor ?? 0);
    porEmpresa.set(k, g);
  }
  const linhas: LinhaTabela[] = monitores.map((x) => {
    // o Ambiente Nacional só entrega ao próprio CNPJ ou à mesma raiz (matriz/filial): a procuração não vale aqui
    const daRaiz = certificados.filter((k) => k.org_id === x.org_id && k.cnpj.length === 14 && k.cnpj.slice(0, 8) === x.cnpj.slice(0, 8));
    const cert = daRaiz.find((k) => k.cnpj === x.cnpj) ?? daRaiz.find((k) => k.cnpj.slice(8, 12) === "0001") ?? daRaiz[0];
    const s = cert ? situacaoValidade(cert.validade) : null;
    const g = porEmpresa.get(`${x.org_id}:${x.cnpj}`);
    return { ...x, organizacao: x.organizacoes?.nome ?? "", comprasMes: g?.valor ?? 0, notasMes: g?.qtd ?? 0,
      certificado: !cert || !s ? null : { validade: cert.validade, nome: s.nome, classe: s.classe, vencido: s.vencido } };
  });
  const monitorados = new Set(monitores.map((x) => `${x.org_id}:${x.cnpj}`));
  const candidatas = cadastro.filter((e) => !monitorados.has(`${e.org_id}:${e.cnpj}`))
    .map(({ org_id, cnpj, nome, codigo }) => ({ org_id, cnpj, nome, codigo }));
  const notasNoMes = [...porEmpresa.values()].reduce((s, g) => s + g.qtd, 0);
  const comprasNoMes = [...porEmpresa.values()].reduce((s, g) => s + g.valor, 0);

  return (
    <>
      <div className="cabeca-pagina">
        <div>
          <h1>Monitor Fiscal</h1>
          <p className="suave">
            Todo dia, às 11h, o robô consulta o Ambiente Nacional da NF-e e traz as notas destinadas a cada empresa
            monitorada, de qualquer estado, com o XML e o PDF (DANFE).
          </p>
        </div>
      </div>
      {gerencia && <AdicionarMonitor empresas={candidatas} organizacoes={organizacoes} />}

      <div className="painel-numeros monitor-numeros">
        <div className="numero-cartao">
          <span className="numero-icone"><Icone nome="empresas" /></span>
          <span className="nome">Clientes monitorados</span>
          <span className="valor">{numero(monitores.filter((x) => x.ativo).length)}</span>
        </div>
        <div className="numero-cartao">
          <span className="numero-icone"><Icone nome="tarefas" /></span>
          <span className="nome">Notas encontradas</span>
          <span className="valor">{numero(total ?? 0)}</span>
          <span className="suave">desde o início do monitoramento</span>
        </div>
        <div className="numero-cartao">
          <span className="numero-icone"><Icone nome="agendar" /></span>
          <span className="nome">Notas no mês</span>
          <span className="valor">{numero(notasNoMes)}</span>
        </div>
        <div className="numero-cartao">
          <span className="numero-icone"><Icone nome="mei" /></span>
          <span className="nome">Compras no mês</span>
          <span className="valor valor-moeda">{comprasNoMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
        </div>
      </div>

      <section className="cartao">
        {!linhas.length ? (
          <p className="suave">
            Nenhuma empresa no monitoramento ainda.{" "}
            {gerencia ? "Use \"Adicionar ao monitoramento\" e escolha as empresas." : "Peça ao gestor do escritório para incluir as empresas."}{" "}
            Cada uma precisa do certificado A1 dela (ou da matriz) em <Link href="/painel/certificados">Certificados</Link>.
          </p>
        ) : (
          <TabelaMonitor linhas={linhas} gerencia={gerencia} admin={admin} />
        )}
      </section>

      <section className="cartao">
        <h2 className="titulo-cartao">Cobertura</h2>
        <div className="cobertura">
          <span className="cobertura-rotulo">NF-e destinadas</span>
          <span className="ufs">{UFS.map((uf) => <span key={uf} className="uf ativa">{uf}</span>)}</span>
          <span className="cobertura-rotulo">NF-e emitidas e NFC-e</span>
          <span className="suave">Em breve: dependem da SEFAZ de cada estado (a da Paraíba ainda não oferece).</span>
        </div>
        <p className="suave">
          A nota que só chega em resumo ganha a <b>Ciência da Operação</b> (evento neutro, que não confirma nem recusa a
          compra) para o XML completo vir; dá para desligar por empresa ao incluir. O certificado precisa ser o da própria
          empresa ou o da matriz: a procuração do e-CAC não vale no Ambiente Nacional da NF-e.
        </p>
      </section>
    </>
  );
}
