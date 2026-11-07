"use client";

import { useActionState, useEffect, useState } from "react";
import { formatarDocumento } from "@/lib/documentos";
import { adicionarMonitor } from "./actions";

type Empresa = { org_id: string; cnpj: string; nome: string; codigo: string };
type Org = { id: string; nome: string };

/** "Adicionar ao monitoramento": escolhe, entre as empresas cadastradas, as que o robô passa a consultar todo dia. */
export default function AdicionarMonitor({ empresas, organizacoes }: { empresas: Empresa[]; organizacoes?: Org[] }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, enviando] = useActionState(adicionarMonitor, undefined);
  const [org, setOrg] = useState(organizacoes ? "" : empresas[0]?.org_id ?? "");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState("");
  useEffect(() => { if (estado?.ok) { setMarcadas(new Set()); setAberto(false); } }, [estado]);

  const daOrg = organizacoes ? empresas.filter((e) => e.org_id === org) : empresas;
  const termo = filtro.trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  const visivel = (e: Empresa) => !termo || e.nome.toLowerCase().includes(termo) || (!!digitos && e.cnpj.includes(digitos))
    || e.codigo.toLowerCase() === termo;
  const todas = daOrg.length > 0 && daOrg.every((e) => marcadas.has(e.cnpj));
  const alternar = (cnpj: string) => setMarcadas((m) => {
    const n = new Set(m);
    if (n.has(cnpj)) n.delete(cnpj); else n.add(cnpj);
    return n;
  });

  return (
    <div className="adicionar-monitor">
      {estado?.ok && !aberto && <div className="faixa ok">{estado.ok}</div>}
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        {aberto ? "Fechar" : "+ Adicionar ao monitoramento"}
      </button>
      {aberto && (
        <form action={acao} className="cartao painel-adicionar">
          <h2 className="titulo-cartao">Adicionar ao monitoramento</h2>
          {estado?.erro && <div className="faixa erro">{estado.erro}</div>}
          {organizacoes && (
            <>
              <label htmlFor="mon-org">Organização</label>
              <select id="mon-org" name="org_id" required value={org} onChange={(e) => { setOrg(e.target.value); setMarcadas(new Set()); }}>
                <option value="" disabled>Escolha…</option>
                {organizacoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            </>
          )}
          {organizacoes && !org ? null : !daOrg.length ? (
            <p className="suave">Todas as empresas cadastradas com CNPJ já estão no monitoramento (ou ainda não há empresas no cadastro).</p>
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
          <label className="caixa-opcao">
            <input type="checkbox" name="ciencia" defaultChecked />
            <span>
              <b>Manifestar a Ciência da Operação</b> nas notas que chegam só em resumo, para baixar o XML completo. É um
              evento neutro: não confirma nem recusa a compra.
            </span>
          </label>
          <p className="suave">Cada empresa precisa do certificado A1 dela (ou da matriz) em Certificados.</p>
          <button type="submit" disabled={enviando || !marcadas.size}>{enviando ? "Incluindo…" : `Incluir ${marcadas.size || ""} no monitoramento`}</button>
        </form>
      )}
    </div>
  );
}
