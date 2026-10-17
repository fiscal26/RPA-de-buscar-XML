"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { dataHoraBR, formatarCnpj } from "@/lib/cnpj";
import { TIPOS, nomeTipo } from "@/lib/xml";
import { confirmarAgendamento, prepararAgendamento, type Previa } from "./actions";

type OrgOpcao = { id: string; nome: string };

export default function FormAgendamento({ organizacoes, inicio, fim }: { organizacoes?: OrgOpcao[]; inicio: string; fim: string }) {
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
  const semSenha = previa?.itens?.filter((i) => !i.senhaCifrada).length ?? 0;

  return (
    <>
      <form action={ler}>
        {previa?.erro && <div className="faixa erro">{previa.erro}</div>}
        {organizacoes && (
          <>
            <label htmlFor="org_id">Organização</label>
            <select id="org_id" name="org_id" required defaultValue="">
              <option value="" disabled>Escolha…</option>
              {organizacoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </>
        )}
        <label htmlFor="arquivo">Planilha das empresas (.xlsx ou .csv)</label>
        <input id="arquivo" name="arquivo" type="file" accept=".xlsx,.xlsm,.csv,.txt" required />

        <div className="linha">
          <div>
            <label htmlFor="inicio">Período: de</label>
            <input id="inicio" name="inicio" type="date" defaultValue={inicio} required />
          </div>
          <div>
            <label htmlFor="fim">até</label>
            <input id="fim" name="fim" type="date" defaultValue={fim} required />
          </div>
        </div>

        <label>Tipos de XML</label>
        <div className="opcoes">
          {TIPOS.map((t) => (
            <label key={t.id}>
              <input type="checkbox" name="tipo" value={t.id} defaultChecked={t.id !== "nfce_emitidas"} />
              {t.nome}
            </label>
          ))}
        </div>

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
            <b>{previa.itens.length}</b> empresa(s) · período {previa.inicio?.split("-").reverse().join("/")} a{" "}
            {previa.fim?.split("-").reverse().join("/")} · {previa.tipos?.map(nomeTipo).join(", ")} ·{" "}
            {previa.executarEm ? `começa em ${dataHoraBR(previa.executarEm)}` : "começa assim que possível"}.
          </p>
          {novas > 0 && <p className="suave">{novas} empresa(s) nova(s) serão cadastradas com a senha da planilha.</p>}
          {semSenha > 0 && <p className="suave">{semSenha} empresa(s) sem senha na planilha: será usada a senha já cadastrada.</p>}
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
            <table>
              <thead><tr><th>Linha</th><th>CNPJ</th><th>Apelido</th><th>Login ATF</th><th>Senha</th></tr></thead>
              <tbody>
                {previa.itens.map((i) => (
                  <tr key={i.cnpj}>
                    <td>{i.linha}</td><td>{formatarCnpj(i.cnpj)}</td><td>{i.apelido}</td><td>{i.login || "o próprio CNPJ"}</td>
                    <td>{i.senhaCifrada ? (i.cadastrada ? "nova (substitui)" : "nova") : "já cadastrada"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {resultado?.erro && <div className="faixa erro" style={{ marginTop: "1rem" }}>{resultado.erro}</div>}
          <p><button onClick={confirmar} disabled={enviando}>{enviando ? "Agendando…" : "Confirmar agendamento"}</button></p>
          <p className="suave">As senhas já estão cifradas: nem o portal consegue lê-las, só o robô.</p>
        </div>
      )}
    </>
  );
}
