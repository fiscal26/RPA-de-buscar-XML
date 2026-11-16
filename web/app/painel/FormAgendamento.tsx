"use client";

import Formulario from "@/components/ui/Formulario";

import PeriodoCompetencias from "@/components/ui/PeriodoCompetencias";
import Tabela from "@/components/ui/Tabela";

import Escolha from "@/components/ui/Escolha";
import Segmentado from "@/components/ui/Segmentado";
import SeletorArquivo from "@/components/ui/SeletorArquivo";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { competenciaBR, dataHoraBR, formatarIe } from "@/lib/documentos";
import { TIPOS, nomeTipo } from "@/lib/xml";
import { confirmarAgendamento, prepararAgendamento, type Previa } from "./actions";

type OrgOpcao = { id: string; nome: string };

export type EmpresaSefazOpcao = {id:string;org_id:string;ie:string;cnpj:string;nome:string;codigo:string;acesso_id:string|null};
export default function FormAgendamento({ organizacoes, competencia, empresas = [], fonteInicial = "planilha", orgInicial, empresaInicial }: { organizacoes?: OrgOpcao[]; competencia: string; empresas?: EmpresaSefazOpcao[]; fonteInicial?: "planilha"|"cadastro"; orgInicial?:string; empresaInicial?:string }) {
  const [previa, ler, lendo] = useActionState(prepararAgendamento, undefined);
  const conferencia = useRef<HTMLDivElement>(null);
  useEffect(() => { if (previa?.itens && !previa.erro) conferencia.current?.focus(); }, [previa]);
  const [resultado, setResultado] = useState<Previa | null>(null);
  const sucesso = useRef<HTMLDivElement>(null);
  useEffect(() => { if (resultado?.ok) sucesso.current?.focus(); }, [resultado?.ok]);
  const [enviando, iniciar] = useTransition();
  const [fonte,setFonte] = useState<"planilha"|"cadastro">(fonteInicial);
  const [org,setOrg] = useState(organizacoes ? (organizacoes.some((o)=>o.id===orgInicial)?orgInicial!:"") : empresas[0]?.org_id??"");
  const [marcadas,setMarcadas] = useState(new Set(empresas.filter((e)=>e.id===empresaInicial&&(!organizacoes||e.org_id===orgInicial)).map((e)=>e.id)));
  const [filtro,setFiltro] = useState("");
  const daOrg = organizacoes ? empresas.filter((e)=>e.org_id===org) : empresas;
  const disponiveis = daOrg.filter((e)=>e.acesso_id);
  const todas = disponiveis.length>0&&disponiveis.every((e)=>marcadas.has(e.id));
  const termo=filtro.toLocaleLowerCase("pt-BR").trim();
  const visivel=(e:EmpresaSefazOpcao)=>!termo||`${e.nome} ${e.codigo} ${e.ie} ${e.cnpj}`.toLocaleLowerCase("pt-BR").includes(termo)||(/^[-.\d\s/]+$/.test(termo)&&`${e.ie} ${e.cnpj}`.includes(termo.replace(/\D/g,"")));
  const [quando, setQuando] = useState<"agora" | "agendar">("agora");

  function confirmar() {
    if (!previa) return;
    iniciar(async () => setResultado(await confirmarAgendamento(previa)));
  }

  if (resultado?.ok) {
    return (
      <div ref={sucesso} tabIndex={-1}>
        <div className="faixa ok" role="status">{resultado.ok} O robô salva os arquivos na pasta configurada no computador dele.</div>
        <div className="periodo-acompanhamento">{(resultado.agendamentoIds ?? [resultado.agendamentoId!]).map((id, i) =>
          <Link className="botao secundario" key={id} href={`/painel/agendamentos/${id}`}>Acompanhar {resultado.competenciasAgendadas?.[i] ? competenciaBR(resultado.competenciasAgendadas[i]) : `competência ${i + 1}`}</Link>)}</div>{" "}
        <button className="secundario" onClick={() => location.reload()}>Novo agendamento</button>
      </div>
    );
  }

  const novas = previa?.itens?.filter((i) => !i.cadastrada).length ?? 0;
  const contagem = TIPOS.map((t) => ({ ...t, n: previa?.itens?.filter((i) => i.tipos.includes(t.id)).length ?? 0 }));

  return (
    <>
      <Formulario action={ler}>
        {previa?.erro && <div className="faixa erro" role="alert">{previa.erro}</div>}
        {previa?.erro && !!previa.erros?.length && (
          <div className="faixa erro" role="alert"><ul>{previa.erros.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul></div>
        )}
        {organizacoes && (
          <>
            <label htmlFor="org_id">Organização</label>
<Escolha id="org_id" nome="org_id" rotulo="Organização" placeholder="Escolha a organização…"
              valor={org} aoMudar={(v)=>{setOrg(v);setMarcadas(new Set());}} opcoes={organizacoes.map((o) => ({ id: o.id, titulo: o.nome }))} />
          </>
        )}
        <p className="rotulo-campo">Empresas</p><Segmentado nome="fonte" rotulo="Empresas" valor={fonte} aoMudar={setFonte} opcoes={[{id:"planilha",texto:"As de uma planilha"},{id:"cadastro",texto:"Escolher entre as cadastradas"}]} />
        {fonte === "planilha" ? <><label htmlFor="arquivo">Planilha das empresas</label><SeletorArquivo id="arquivo" nome="arquivo" aceita=".xlsx,.xlsm,.csv" obrigatorio titulo="Escolher a planilha (.xlsx ou .csv)" /></> : organizacoes&&!org ? <p className="suave">Escolha a organização para ver as empresas cadastradas.</p> : !daOrg.length ? <p className="suave">Nenhuma empresa SEFAZ cadastrada. <Link href="/painel/empresas/nova?origem=sefaz">Cadastrar empresa</Link></p> : <div className="selecao-empresas"><div className="selecao-topo"><label className="selecionar-todas"><input type="checkbox" checked={todas} onChange={()=>setMarcadas(todas?new Set():new Set(disponiveis.map((e)=>e.id)))} />Selecionar todas com acesso ATF</label><input type="search" aria-label="Procurar empresa SEFAZ" placeholder="Nome, código, CNPJ ou IE" value={filtro} onChange={(e)=>setFiltro(e.target.value)} /></div><div className="lista-empresas" role="group" aria-label="Empresas SEFAZ cadastradas">{daOrg.map((e)=><label key={e.id} hidden={!visivel(e)}><input type="checkbox" name="empresas" value={e.id} disabled={!e.acesso_id} checked={marcadas.has(e.id)} onChange={(ev)=>setMarcadas((m)=>{const n=new Set(m);if(ev.target.checked)n.add(e.id);else n.delete(e.id);return n;})} /><span className="nome-empresa">{e.nome}{!e.acesso_id&&<small> · falta login ATF</small>}</span><span className="doc suave">IE {formatarIe(e.ie)}</span></label>)}</div><p className="suave">{marcadas.size} selecionadas. Serão usados os serviços e logins já salvos no cadastro.</p></div>}

        <PeriodoCompetencias competencia={competencia} minimo="2006-01" />

        <p className="rotulo-campo">Quando executar</p>
        <Segmentado nome="quando" rotulo="Quando executar" valor={quando} aoMudar={setQuando}
          opcoes={[{ id: "agora", texto: "Assim que possível" }, { id: "agendar", texto: "Em data e hora marcadas" }]} />
        {quando === "agendar" && (
          <>
            <label htmlFor="sefaz-executar">Data e hora de início</label>
            <input id="sefaz-executar" name="executar_em" type="datetime-local" required aria-describedby="sefaz-horario" style={{ maxWidth: 260 }} />
            <p id="sefaz-horario" className="suave">Horário de Brasília.</p>
          </>
        )}
        <p className="form-envio"><button type="submit" disabled={lendo}>{lendo ? "Conferindo…" : fonte === "cadastro" ? "Conferir empresas" : "Ler planilha"}</button></p>
        <span className="sr" role="status">{lendo ? "Lendo e conferindo as empresas. Aguarde." : ""}</span>
      </Formulario>

      {previa?.itens && !previa.erro && (
        <div ref={conferencia} tabIndex={-1} className="conferencia-planilha" style={{ marginTop: "1.5rem" }}>
          <h2>{previa.nomeArquivo === "Empresas cadastradas" ? "Confira as empresas escolhidas" : `Confira a planilha ${previa.nomeArquivo}`}</h2>
          <p>
            <b>{previa.itens.length}</b> {previa.itens.length === 1 ? "empresa" : "empresas"} · período <b>{competenciaBR(previa.competencia)}{previa.competenciaFinal && previa.competenciaFinal !== previa.competencia && ` a ${competenciaBR(previa.competenciaFinal)}`}</b> ·{" "}
            {previa.executarEm ? `começa em ${dataHoraBR(previa.executarEm)}` : "começa assim que possível"}.
          </p>
          <p className="suave">
            {contagem.filter((t) => t.n).map((t) => `${t.nome}: ${t.n}`).join(" · ")}
            {novas > 0 && ` · ${novas} ${novas === 1 ? "empresa nova" : "empresas novas"} no cadastro`}
          </p>
          {!!previa.acessos?.length && (
            <p className="suave">
              Logins do ATF:{" "}
              {previa.acessos.map((a) => `${a.login} (${a.senhaCifrada ? (a.cadastrado ? "senha nova" : "novo") : "senha já cadastrada"})`).join(", ")}.
            </p>
          )}
          {!!previa.erros?.length && (
            <div className="faixa erro" role="alert">
              <b>{previa.erros.length === 1 ? "1 linha ignorada:" : `${previa.erros.length} linhas ignoradas:`}</b>
              <ul>{previa.erros.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          {!!previa.avisos?.length && (
            <div className="faixa alerta" role="status"><ul>{previa.avisos.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul></div>
          )}
          <details>
            <summary>Ver empresas</summary>
            <Tabela rotulo="Prévia das empresas SEFAZ">
              <table>
                <caption className="sr">Prévia das empresas SEFAZ</caption>
                <thead><tr><th scope="col">Linha</th><th scope="col">ID</th><th scope="col">Nome fantasia</th><th scope="col">Inscrição estadual</th><th scope="col">Login</th><th scope="col">Serviços</th></tr></thead>
                <tbody>
                  {previa.itens.map((i) => (
                    <tr key={i.ie}>
                      <td>{i.linha}</td><td>{i.codigo}</td><td>{i.nome}</td><td>{formatarIe(i.ie)}</td><td>{i.login}</td>
                      <td>{i.tipos.map(nomeTipo).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tabela>
          </details>
          {resultado?.erro && <div className="faixa erro" role="alert" style={{ marginTop: "1rem" }}>{resultado.erro}</div>}
          <p><button onClick={confirmar} disabled={enviando}>{enviando ? "Agendando…" : "Confirmar agendamento"}</button></p>
          <p className="suave">As senhas já estão cifradas: nem o portal consegue lê-las, só o robô.</p>
        </div>
      )}
    </>
  );
}
