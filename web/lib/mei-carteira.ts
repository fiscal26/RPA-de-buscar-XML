import { analisarAno, type Ajuste, type MesAtf } from "./mei";

export type CadastroMei = {
  org_id: string; cnpj: string; nome: string; ativo: boolean; inicio_atividade: string;
  inicio_mei: string; fim_mei: string | null;
};
export type MesNfse = { org_id: string; cnpj: string; competencia: string; valor: number;
  quantidade: number; consultado_em: string; iniciado_em: string };
export type GrupoMei = { org: string; ie: string; nome: string; meses: MesAtf[]; ajustes: Ajuste[] };
type Vinculo = { org_id: string; ie: string; cnpj: string; nome: string };

/** Um CNPJ por escritório. Meses/ajustes do ATF continuam identificados pela IE no banco. */
export function consolidarCarteira(ano: number, grupos: GrupoMei[], vinculos: Vinculo[], cadastros: CadastroMei[], nfse: MesNfse[], ajustes: Ajuste[]) {
  const chave = (org: string, doc: string) => `${org}|${doc}`;
  const porIe = new Map(vinculos.map((v) => [chave(v.org_id, v.ie), v]));
  const cadastro = new Map(cadastros.map((c) => [chave(c.org_id, c.cnpj), c]));
  const carteira = new Map<string, GrupoMei & { cnpj: string; aliases: string[]; cadastro?: CadastroMei }>();
  function grupo(org: string, doc: string, nome: string) {
    const cnpj = doc.length === 14 ? doc : porIe.get(chave(org, doc))?.cnpj ?? "";
    const id = /^\d{14}$/.test(cnpj) ? cnpj : doc;
    const k = chave(org, id);
    if (!carteira.has(k)) carteira.set(k, { org, ie: id, cnpj: id.length === 14 ? id : "", nome,
      meses: [], ajustes: [], aliases: [id], cadastro: cadastro.get(k) });
    const g = carteira.get(k)!;
    if (!g.aliases.includes(doc)) g.aliases.push(doc);
    return g;
  }
  for (const g of grupos) {
    const alvo = grupo(g.org, g.ie, g.nome);
    alvo.meses.push(...g.meses); alvo.ajustes.push(...g.ajustes);
  }
  for (const c of cadastros) if (c.ativo) grupo(c.org_id, c.cnpj, c.nome);
  for (const m of nfse) {
    const g = carteira.get(chave(m.org_id, m.cnpj));
    if (!g) continue; // uma importação não cadastra automaticamente uma empresa como MEI
    g.meses.push({ org_id: m.org_id, ie: m.cnpj, nome: g.nome, competencia: m.competencia,
      saidas: 0, entradas: null, qtd_saidas: 0, qtd_entradas: null, cartao: null, qtd_cartao: null,
      sem_movimento: Number(m.quantidade) === 0, simei: null, inicio_atividade: null, origem: "nfse",
      nfse: Number(m.valor), consultado_em: m.consultado_em });
  }
  for (const a of ajustes.filter((a) => a.ie.length === 14)) {
    const g = carteira.get(chave(a.org_id, a.ie));
    if (g && !g.ajustes.some((x) => x.id === a.id)) g.ajustes.push({ ...a, valor: Number(a.valor) });
  }
  return [...carteira.values()].filter((g) => {
    const c = g.cadastro;
    return !c || (c.ativo && c.inicio_mei.slice(0, 4) <= String(ano) && (!c.fim_mei || c.fim_mei.slice(0, 4) >= String(ano)));
  }).map((g) => {
    const meses: MesAtf[] = [];
    for (let i = 1; i <= 12; i++) {
      const competencia = `${ano}-${String(i).padStart(2, "0")}-01`;
      const fontes = g.meses.filter((m) => m.competencia.slice(0, 7) === competencia.slice(0, 7));
      if (!fontes.length) continue;
      const atf = fontes.filter((m) => m.origem !== "nfse");
      const servicos = fontes.find((m) => m.origem === "nfse");
      // NFS-e eventualmente listada no ATF é substituída pela fonte nacional, nunca somada duas vezes.
      const ehServico = (tipo: string) => /nfs[\s-]*e|nota.*servi[cç]o/i.test(tipo);
      const soma = (campo: "saidas" | "entradas" | "cartao") => atf.reduce((s, m) => s + (Number(m[campo]) || 0), 0);
      const duplicado = servicos ? atf.flatMap((m) => m.itens ?? []).filter((d) => ehServico(d.tipo)).reduce((s, d) => s + (Number(d.saidas) || 0), 0) : 0;
      const semDetalhe = !!servicos && atf.some((m) => !m.itens?.length && Number(m.saidas) > 0);
      meses.push({ ...fontes[0], competencia, saidas: Math.max(0, soma("saidas") - duplicado), entradas: soma("entradas"),
        cartao: soma("cartao"), nfse: Number(servicos?.nfse) || 0, consultadoAtf: !!atf.length,
        consultadoNfse: !!servicos, sobreposicaoIncerta: semDetalhe,
        sem_movimento: fontes.every((m) => m.sem_movimento), itens: atf.flatMap((m) => m.itens ?? []),
        consultado_em: fontes.map((m) => m.consultado_em).filter(Boolean).sort().at(-1) });
    }
    const c = g.cadastro;
    const noPeriodo = (ref: string) => !c || (ref.slice(0, 7) >= c.inicio_mei.slice(0, 7) && (!c.fim_mei || ref.slice(0, 7) <= c.fim_mei.slice(0, 7)));
    const visiveis = meses.filter((m) => noPeriodo(m.competencia));
    return { ...g, nome: c?.nome || g.nome, meses: visiveis, ano: analisarAno(ano, visiveis, g.ajustes, c) };
  }).sort((a, b) => b.ano.faturamento.total - a.ano.faturamento.total || a.nome.localeCompare(b.nome));
}
