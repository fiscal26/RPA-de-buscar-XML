"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { competenciaBR, dataHoraBR, formatarIe } from "@/lib/documentos";
import { TIPOS, nomeTipo } from "@/lib/xml";
import { confirmarAgendamento, prepararAgendamento, type Previa } from "./actions";

type OrgOpcao = { id: string; nome: string };

export default function FormAgendamento({ organizacoes, competencia }: { organizacoes?: OrgOpcao[]; competencia: string }) {
  const [previa, ler, lendo] = useActionState(prepararAgendamento, undefined);
  const [resultado, setResultado] = useState<Previa | null>(null);
  const [enviando, iniciar] = useTransition();
  const [quando, setQuando] = useState<"agora" | "agendar">("agora");

  function confirmar() {
    if (!previa) return;
    iniciar(async () => setResultado(await confirmarAgendamento(previa)));
  }

  if (resultado?.ok) {
    return (
      <div>
        <div className="faixa ok">{resultado.ok} O robô salva os XML na pasta configurada no computador dele.</div>
        <Link className="botao" href={`/agendamentos/${resultado.agendamentoId}`}>Acompanhar este agendamento</Link>{" "}
        <button className="secundario" onClick={() => location.reload()}>Novo agendamento</button>
      </div>
    );
  }

  const novas = previa?.itens?.filter((i) => !i.cadastrada).length ?? 0;
  const contagem = TIPOS.map((t) => ({ ...t, n: previa?.itens?.filter((i) => i.tipos.includes(t.id)).length ?? 0 }));

  return (
    <>
      <form action={ler}>
        {previa?.erro && <div className="faixa erro">{previa.erro}</div>}
        {previa?.erro && !!previa.erros?.length && (
          <div className="faixa erro"><ul>{previa.erros.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul></div>
        )}
        {organizacoes && (
          <>
            <label htmlFor="org_id">Organização</label>
            <select id="org_id" name="org_id" required defaultValue="">
              <option value="" disabled>Escolha…</option>
              {organizacoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </>
        )}
        <label htmlFor="arquivo">Planilha das empresas (.xlsx)</label>
        <input id="arquivo" name="arquivo" type="file" accept=".xlsx,.xlsm,.csv" required />

        <label htmlFor="competencia">Competência</label>
        <input id="competencia" name="competencia" type="month" defaultValue={competencia} required style={{ maxWidth: 220 }} />
        <p className="suave">O robô busca do 1º ao último dia do mês.</p>

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
          <h2>Conferência — {previa.nomeArquivo}</h2>
          <p>
            <b>{previa.itens.length}</b> empresa(s) · competência <b>{competenciaBR(previa.competencia)}</b> ·{" "}
            {previa.executarEm ? `começa em ${dataHoraBR(previa.executarEm)}` : "começa assim que possível"}.
          </p>
          <p className="suave">
            {contagem.filter((t) => t.n).map((t) => `${t.nome}: ${t.n}`).join(" · ")}
            {novas > 0 && ` · ${novas} empresa(s) nova(s) no cadastro`}
          </p>
          {!!previa.acessos?.length && (
            <p className="suave">
              Logins do ATF:{" "}
              {previa.acessos.map((a) => `${a.login} (${a.senhaCifrada ? (a.cadastrado ? "senha nova" : "novo") : "senha já cadastrada"})`).join(", ")}.
            </p>
          )}
          {!!previa.erros?.length && (
            <div className="faixa erro">
              <b>{previa.erros.length} linha(s) ignorada(s):</b>
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
                <thead><tr><th>Linha</th><th>ID</th><th>Nome fantasia</th><th>Inscrição estadual</th><th>Login</th><th>XML</th></tr></thead>
                <tbody>
                  {previa.itens.map((i) => (
                    <tr key={i.ie}>
                      <td>{i.linha}</td><td>{i.codigo}</td><td>{i.nome}</td><td>{formatarIe(i.ie)}</td><td>{i.login}</td>
                      <td>{i.tipos.map(nomeTipo).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {resultado?.erro && <div className="faixa erro" style={{ marginTop: "1rem" }}>{resultado.erro}</div>}
          <p><button onClick={confirmar} disabled={enviando}>{enviando ? "Agendando…" : "Confirmar agendamento"}</button></p>
          <p className="suave">As senhas já estão cifradas: nem o portal consegue lê-las, só o robô.</p>
        </div>
      )}
    </>
  );
}
