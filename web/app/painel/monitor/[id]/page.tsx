import Link from "next/link";
import { notFound } from "next/navigation";
import { contexto } from "@/lib/sessao";
import { dataBR, dataHoraBR, formatarDocumento } from "@/lib/documentos";
import { SITUACAO_MONITOR, SITUACAO_NOTA, reaisMonitor } from "@/lib/monitor";
import { alternarCiencia } from "../actions";

type Nota = {
  chave: string; numero: string; serie: string; emitente_cnpj: string; emitente_nome: string; emitente_uf: string;
  valor: number | null; emissao: string | null; situacao: string; completa: boolean; manifestada_em: string | null;
  pdf: boolean; encontrada_em: string;
};

const competencia = (iso: string | null) => (iso ? `${iso.slice(5, 7)}${iso.slice(0, 4)}` : "");

export default async function HistoricoMonitor({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }>;
}) {
  const { id } = await params;
  const { mes } = await searchParams;
  const { supabase, perfil, admin } = await contexto();
  const podeMudar = admin || perfil.papel === "gestor";
  const { data: m } = await supabase.from("xml_nfe_monitor")
    .select("id, org_id, cnpj, nome, codigo, status, mensagem, ultima_consulta, proxima_consulta, ciencia").eq("id", id).maybeSingle();
  if (!m) notFound();
  let consulta = supabase.from("xml_nfe_notas")
    .select("chave, numero, serie, emitente_cnpj, emitente_nome, emitente_uf, valor, emissao, situacao, completa, manifestada_em, pdf, encontrada_em")
    .eq("org_id", m.org_id).eq("cnpj", m.cnpj).order("emissao", { ascending: false, nullsFirst: false }).limit(1000);
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [a, b] = mes.split("-").map(Number);
    consulta = consulta.gte("emissao", new Date(Date.UTC(a, b - 1, 1, 3)).toISOString()).lt("emissao", new Date(Date.UTC(a, b, 1, 3)).toISOString());
  }
  const notas = ((await consulta).data ?? []) as Nota[];
  const validas = notas.filter((x) => x.situacao === "autorizada");
  const total = validas.reduce((s, x) => s + Number(x.valor ?? 0), 0);
  const s = SITUACAO_MONITOR[m.status] ?? SITUACAO_MONITOR.fila;

  return (
    <>
      <p><Link href="/painel/monitor" className="link-discreto">← Monitor Fiscal</Link></p>
      <div className="cabeca-pagina">
        <div>
          <h1>{m.codigo ? `${m.codigo} · ` : ""}{m.nome}</h1>
          <p className="suave">
            CNPJ {formatarDocumento(m.cnpj)} · <span className={`status ${s.classe}`}>{s.nome}</span>
            {m.ultima_consulta && <> · última consulta {dataHoraBR(m.ultima_consulta)}</>} · próxima {dataHoraBR(m.proxima_consulta)}
          </p>
          {m.mensagem && <p className="suave">{m.mensagem}</p>}
          <form action={alternarCiencia} className="suave">
            <input type="hidden" name="id" value={m.id} />
            <input type="hidden" name="ligar" value={m.ciencia ? "0" : "1"} />
            Ciência da Operação automática: <strong>{m.ciencia ? "ligada" : "desligada"}</strong>
            {!m.ciencia && <> · sem ela, o Ambiente Nacional entrega só o resumo das notas, sem o XML</>}
            {podeMudar && <> · <button type="submit" className={m.ciencia ? "fantasma pequeno" : "secundario pequeno"}>{m.ciencia ? "Desligar" : "Ligar a ciência"}</button></>}
          </form>
        </div>
      </div>

      <section className="cartao">
        <div className="cartao-topo">
          <h2 className="titulo-cartao">NF-e destinadas</h2>
          <form className="filtro-mes">
            <label htmlFor="mes" className="suave">Mês da emissão</label>
            <input id="mes" name="mes" type="month" defaultValue={mes ?? ""} />
            <button type="submit" className="secundario">Filtrar</button>
            {mes && <Link href={`/painel/monitor/${id}`} className="link-discreto">Todas</Link>}
          </form>
        </div>
        <p className="suave">
          {notas.length} {notas.length === 1 ? "nota" : "notas"}{mes ? "" : " (as mais recentes)"} · {reaisMonitor(total)} em notas autorizadas.
          Os arquivos ficam na pasta da empresa, em <code>MMAAAA/NF-e Recebidas</code> (XML e PDF), no Google Drive do escritório.
        </p>
        {!notas.length ? (
          <p className="suave">Nenhuma nota encontrada{mes ? " neste mês" : " ainda"}.</p>
        ) : (
          <div className="tabela-rolagem">
            <table>
              <thead>
                <tr><th>Emissão</th><th>Número</th><th>Emitente</th><th>UF</th><th>Valor</th><th>Situação</th><th>Arquivos</th><th>Pasta</th><th>Chave de acesso</th></tr>
              </thead>
              <tbody>
                {notas.map((x) => {
                  const sit = SITUACAO_NOTA[x.situacao] ?? SITUACAO_NOTA.autorizada;
                  return (
                    <tr key={x.chave}>
                      <td>{x.emissao ? dataBR(x.emissao.slice(0, 10)) : "—"}</td>
                      <td>{x.numero}{x.serie && <span className="suave">/{x.serie}</span>}</td>
                      <td className="nome-empresa">{x.emitente_nome || "—"}<br /><small className="suave doc">{formatarDocumento(x.emitente_cnpj)}</small></td>
                      <td>{x.emitente_uf}</td>
                      <td>{x.valor === null ? "—" : reaisMonitor(Number(x.valor))}</td>
                      <td><span className={`status ${sit.classe}`}>{sit.nome}</span></td>
                      <td>
                        {x.completa
                          ? <span className="status st-ok">XML{x.pdf ? " e PDF" : ""}</span>
                          : <span className="status st-alerta" title={x.manifestada_em ? "Ciência registrada; o XML chega na próxima consulta"
                              : m.ciencia ? "A ciência ainda não foi aceita: veja a mensagem da última consulta" : "Ciência automática desligada"}>
                              {x.manifestada_em ? "Aguardando XML" : "Só resumo"}
                            </span>}
                      </td>
                      <td className="doc suave">{competencia(x.emissao)}</td>
                      <td className="doc chave-nfe">{x.chave}</td>
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
