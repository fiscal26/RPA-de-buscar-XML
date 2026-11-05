"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { competenciaBR, dataHoraBR, formatarDocumento } from "@/lib/documentos";
import { TIPOS_NFSE, nomeTipo } from "@/lib/xml";
import { confirmarAgendamentoNfse, prepararAgendamentoNfse, type PreviaNfse, type SituacaoCertificado } from "./actions-nfse";

type OrgOpcao = { id: string; nome: string };
export type EmpresaOpcao = { org_id: string; cnpj: string; nome: string; codigo: string };
export type CertificadoOpcao = { id: string; org_id: string; nome: string; cnpj: string; procurador: boolean; vencido: boolean };

const CERTIFICADO: Record<SituacaoCertificado, { nome: string; classe: string }> = {
  proprio: { nome: "Próprio", classe: "st-ok" },
  matriz: { nome: "Da matriz", classe: "st-ok" },
  escritorio: { nome: "Do escritório (procuração)", classe: "st-ok" },
  vencido: { nome: "Vencido", classe: "st-erro" },
  falta: { nome: "Falta", classe: "st-erro" },
};

export default function FormAgendamentoNfse({ organizacoes, competencia, empresas, certificados }: {
  organizacoes?: OrgOpcao[]; competencia: string; empresas: EmpresaOpcao[]; certificados: CertificadoOpcao[];
}) {
  const [previa, ler, lendo] = useActionState(prepararAgendamentoNfse, undefined);
  const [resultado, setResultado] = useState<PreviaNfse | null>(null);
  const [enviando, iniciar] = useTransition();
  const [quando, setQuando] = useState<"agora" | "agendar">("agora");
  const [fonte, setFonte] = useState<"planilha" | "cadastro">("planilha");
  const [org, setOrg] = useState(organizacoes ? "" : empresas[0]?.org_id ?? certificados[0]?.org_id ?? "");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState("");
  // administrador: só as empresas e os certificados da organização escolhida
  const daOrg = organizacoes ? empresas.filter((e) => e.org_id === org) : empresas;
  const certsDaOrg = organizacoes ? certificados.filter((c) => c.org_id === org) : certificados;
  const termo = filtro.trim().toLowerCase();
  const visivel = (e: EmpresaOpcao) => !termo || e.nome.toLowerCase().includes(termo) || e.codigo.toLowerCase() === termo
    || e.cnpj.includes(termo.replace(/\D/g, "") || "#");
  const todas = daOrg.length > 0 && daOrg.every((e) => marcadas.has(e.cnpj));
  const alternar = (cnpj: string) => setMarcadas((m) => {
    const n = new Set(m);
    if (n.has(cnpj)) n.delete(cnpj); else n.add(cnpj);
    return n;
  });

  function confirmar() {
    if (!previa) return;
    iniciar(async () => setResultado(await confirmarAgendamentoNfse(previa)));
  }

  if (resultado?.ok) {
    return (
      <div>
        <div className="faixa ok">{resultado.ok} O robô salva as notas e o relatório na pasta configurada no computador dele.</div>
        <Link className="botao" href={`/painel/agendamentos/${resultado.agendamentoId}`}>Acompanhar este agendamento</Link>{" "}
        <button className="secundario" onClick={() => location.reload()}>Novo agendamento</button>
      </div>
    );
  }

  const novas = previa?.itens?.filter((i) => !i.cadastrada).length ?? 0;
  const contagem = TIPOS_NFSE.map((t) => ({ ...t, n: previa?.itens?.filter((i) => i.tipos.includes(t.id)).length ?? 0 }));

  return (
    <>
      <form action={ler}>
        {previa?.erro && <div className="faixa erro">{previa.erro}</div>}
        {previa?.erro && !!previa.erros?.length && (
          <div className="faixa erro"><ul>{previa.erros.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul></div>
        )}
        {organizacoes && (
          <>
            <label htmlFor="nfse-org">Organização</label>
            <select id="nfse-org" name="org_id" required value={org} onChange={(e) => { setOrg(e.target.value); setMarcadas(new Set()); }}>
              <option value="" disabled>Escolha…</option>
              {organizacoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </>
        )}
        <label>Empresas</label>
        <div className="opcoes">
          <label><input type="radio" name="fonte" value="planilha" checked={fonte === "planilha"} onChange={() => setFonte("planilha")} /> As de uma planilha</label>
          <label><input type="radio" name="fonte" value="cadastro" checked={fonte === "cadastro"} onChange={() => setFonte("cadastro")} /> Escolher entre as cadastradas</label>
        </div>
        {fonte === "planilha" ? (
          <>
            <label htmlFor="nfse-arquivo">Planilha das empresas da NFS-e (.xlsx)</label>
            <input id="nfse-arquivo" name="arquivo" type="file" accept=".xlsx,.xlsm,.csv" required />
          </>
        ) : organizacoes && !org ? (
          <p className="suave">Escolha a organização para ver as empresas cadastradas.</p>
        ) : !daOrg.length ? (
          <p className="suave">
            Nenhuma empresa com CNPJ no cadastro ainda. Envie uma planilha (da NFS-e ou da SEFAZ) uma primeira vez; depois
            elas aparecem aqui para marcar.
          </p>
        ) : (
          <div className="selecao-empresas">
            <div className="selecao-topo">
              <label className="selecionar-todas">
                <input type="checkbox" checked={todas}
                  onChange={() => setMarcadas(todas ? new Set() : new Set(daOrg.map((e) => e.cnpj)))} />
                <b>Selecionar todas</b> <span className="suave">({marcadas.size} de {daOrg.length} marcadas)</span>
              </label>
              <input type="search" placeholder="Procurar por nome, ID ou CNPJ" value={filtro} onChange={(e) => setFiltro(e.target.value)}
                aria-label="Procurar empresa" />
            </div>
            <div className="lista-empresas" role="group" aria-label="Empresas cadastradas">
              {daOrg.map((e) => (
                <label key={e.cnpj} hidden={!visivel(e)}>
                  <input type="checkbox" name="cnpjs" value={e.cnpj} checked={marcadas.has(e.cnpj)} onChange={() => alternar(e.cnpj)} />
                  <span className="suave id-empresa">{e.codigo || "—"}</span>
                  <span className="nome-empresa">{e.nome}</span>
                  <span className="doc suave">{formatarDocumento(e.cnpj)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {certsDaOrg.length > 0 && (
          <>
            <label htmlFor="nfse-certificado">Certificado</label>
            <select id="nfse-certificado" name="certificado_id" defaultValue="" key={org}>
              <option value="">Automático: o da empresa, o da matriz ou o do escritório</option>
              {[true, false].map((proc) => certsDaOrg.some((c) => c.procurador === proc) && (
                <optgroup key={String(proc)} label={proc ? "Do escritório (procuração)" : "Das empresas"}>
                  {certsDaOrg.filter((c) => c.procurador === proc).map((c) => (
                    <option key={c.id} value={c.id} disabled={c.vencido}>
                      {c.nome || formatarDocumento(c.cnpj)} ({formatarDocumento(c.cnpj)}){c.vencido ? " - vencido" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="suave">Com um certificado escolhido, o robô usa só ele para todas as empresas deste agendamento.</p>
          </>
        )}

        <label htmlFor="nfse-competencia">Competência</label>
        <input id="nfse-competencia" name="competencia" type="month" defaultValue={competencia} required style={{ maxWidth: 220 }} />
        <p className="suave">Vêm as notas com essa competência (o mês do serviço), emitidas e recebidas.</p>

        <label>Quando executar</label>
        <div className="opcoes">
          <label><input type="radio" name="quando" value="agora" checked={quando === "agora"} onChange={() => setQuando("agora")} /> Assim que possível</label>
          <label><input type="radio" name="quando" value="agendar" checked={quando === "agendar"} onChange={() => setQuando("agendar")} /> Em data e hora marcadas</label>
        </div>
        {quando === "agendar" && (
          <>
            <input name="executar_em" type="datetime-local" required style={{ maxWidth: 260 }} />
            <p className="suave">Horário de Brasília.</p>
          </>
        )}
        <p><button type="submit" disabled={lendo}>{lendo ? "Lendo…" : "Ler planilha"}</button></p>
      </form>

      {previa?.itens && !previa.erro && (
        <div style={{ marginTop: "1.5rem" }}>
          <h2>{previa.nomeArquivo === "Empresas cadastradas" ? "Confira as empresas escolhidas" : `Confira a planilha ${previa.nomeArquivo}`}</h2>
          <p>
            <b>{previa.itens.length}</b> {previa.itens.length === 1 ? "empresa" : "empresas"} · competência <b>{competenciaBR(previa.competencia)}</b> ·{" "}
            {previa.executarEm ? `começa em ${dataHoraBR(previa.executarEm)}` : "começa assim que possível"}.
            {previa.certificadoNome && <> Certificado: <b>{previa.certificadoNome}</b>.</>}
          </p>
          <p className="suave">
            {contagem.filter((t) => t.n).map((t) => `${t.nome}: ${t.n}`).join(" · ")}
            {novas > 0 && ` · ${novas} ${novas === 1 ? "empresa nova" : "empresas novas"} no cadastro`}
          </p>
          {!!previa.erros?.length && (
            <div className="faixa erro">
              <b>{previa.erros.length === 1 ? "1 linha ignorada:" : `${previa.erros.length} linhas ignoradas:`}</b>
              <ul>{previa.erros.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          {!!previa.avisos?.length && (
            <div className="faixa alerta"><ul>{previa.avisos.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul></div>
          )}
          <details>
            <summary>Ver empresas</summary>
            <div className="tabela-rolagem">
              <table>
                <thead><tr><th>Linha</th><th>ID</th><th>Empresa</th><th>CNPJ</th><th>Certificado</th><th>Serviços</th></tr></thead>
                <tbody>
                  {previa.itens.map((i) => (
                    <tr key={i.cnpj}>
                      <td>{i.linha}</td><td>{i.codigo}</td><td>{i.nome}</td><td>{formatarDocumento(i.cnpj)}</td>
                      <td><span className={`status ${CERTIFICADO[i.certificado].classe}`}>{CERTIFICADO[i.certificado].nome}</span></td>
                      <td>{i.tipos.map(nomeTipo).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {resultado?.erro && <div className="faixa erro" style={{ marginTop: "1rem" }}>{resultado.erro}</div>}
          <p><button onClick={confirmar} disabled={enviando}>{enviando ? "Agendando…" : "Confirmar agendamento"}</button></p>
        </div>
      )}
    </>
  );
}
