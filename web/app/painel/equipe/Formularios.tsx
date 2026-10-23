"use client";

import { useActionState, useRef } from "react";
import { criarEscritorio, criarPessoa, excluirEscritorio, excluirPessoa, trocarSenha, type EstadoEquipe } from "./actions";

type Org = { id: string; nome: string };

/** Senha provisória: digitada ou gerada aqui mesmo (12 caracteres, sem os que se confundem). */
function CampoSenha({ id, opcional = false }: { id: string; opcional?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  function gerar() {
    const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const n = crypto.getRandomValues(new Uint32Array(12));
    if (ref.current) ref.current.value = Array.from(n, (x) => letras[x % letras.length]).join("");
  }
  return (
    <div className="campo-com-botao">
      <input ref={ref} id={id} name="senha" type="text" minLength={8} required={!opcional} autoComplete="off" spellCheck={false} />
      <button type="button" className="secundario" onClick={gerar}>Gerar</button>
    </div>
  );
}

function Aviso({ estado }: { estado: EstadoEquipe }) {
  if (!estado) return null;
  return <div className={`faixa ${estado.erro ? "erro" : "ok"}`}>{estado.erro ?? estado.ok}</div>;
}

export function FormEscritorio() {
  const [estado, acao, enviando] = useActionState(criarEscritorio, undefined);
  return (
    <form action={acao} className="formulario">
      <Aviso estado={estado} />
      <div className="grade-campos">
        <div><label htmlFor="esc-nome">Escritório</label><input id="esc-nome" name="escritorio" type="text" required /></div>
        <div><label htmlFor="esc-doc">CNPJ (opcional)</label><input id="esc-doc" name="documento" type="text" inputMode="numeric" /></div>
        <div><label htmlFor="esc-gestor">Nome do gestor</label><input id="esc-gestor" name="nome" type="text" required /></div>
        <div><label htmlFor="esc-email">E-mail do gestor</label><input id="esc-email" name="email" type="email" required /></div>
        <div><label htmlFor="esc-senha">Senha provisória (opcional)</label><CampoSenha id="esc-senha" opcional /></div>
      </div>
      <button type="submit" disabled={enviando}>{enviando ? "Criando…" : "Criar escritório e gestor"}</button>
    </form>
  );
}

export function FormPessoa({ organizacoes }: { organizacoes?: Org[] }) {
  const [estado, acao, enviando] = useActionState(criarPessoa, undefined);
  return (
    <form action={acao} className="formulario">
      <Aviso estado={estado} />
      <div className="grade-campos">
        {organizacoes && (
          <>
            <div>
              <label htmlFor="p-org">Escritório</label>
              <select id="p-org" name="org_id" required defaultValue="">
                <option value="" disabled>Escolha…</option>
                {organizacoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="p-papel">Papel</label>
              <select id="p-papel" name="papel" defaultValue="usuario">
                <option value="usuario">Colaborador</option>
                <option value="gestor">Gestor</option>
              </select>
            </div>
          </>
        )}
        <div><label htmlFor="p-nome">Nome</label><input id="p-nome" name="nome" type="text" required /></div>
        <div><label htmlFor="p-email">E-mail</label><input id="p-email" name="email" type="email" required /></div>
        <div><label htmlFor="p-senha">Senha provisória (opcional)</label><CampoSenha id="p-senha" opcional /></div>
      </div>
      <button type="submit" disabled={enviando}>{enviando ? "Criando…" : organizacoes ? "Criar acesso" : "Criar acesso do colaborador"}</button>
    </form>
  );
}

export function FormSenha({ id }: { id: string }) {
  const [estado, acao, enviando] = useActionState(trocarSenha, undefined);
  return (
    <form action={acao} className="formulario compacto-senha">
      <input type="hidden" name="id" value={id} />
      <CampoSenha id={`senha-${id}`} />
      <button type="submit" className="pequeno" disabled={enviando}>{enviando ? "Salvando…" : "Definir senha"}</button>
      <Aviso estado={estado} />
    </form>
  );
}

/** Excluir uma pessoa: pede confirmação e apaga o acesso de vez. */
export function ExcluirPessoa({ id, nome }: { id: string; nome: string }) {
  const [estado, acao, enviando] = useActionState(excluirPessoa, undefined);
  return (
    <form action={acao} onSubmit={(e) => {
      if (!confirm(`Excluir o acesso de ${nome}? A pessoa não consegue mais entrar. Para só bloquear por um tempo, use Desativar.`)) e.preventDefault();
    }}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="perigo pequeno" disabled={enviando}>{enviando ? "Excluindo…" : "Excluir"}</button>
      {estado?.erro && <span className="erro-texto">{estado.erro}</span>}
    </form>
  );
}

/** Excluir o escritório inteiro: só com o nome digitado. */
export function ExcluirEscritorio({ id, nome }: { id: string; nome: string }) {
  const [estado, acao, enviando] = useActionState(excluirEscritorio, undefined);
  const campo = useRef<HTMLInputElement>(null);
  return (
    <form action={acao} onSubmit={(e) => {
      const digitado = prompt(`Excluir o escritório ${nome} de vez? Saem as pessoas, as empresas, os logins do ATF, os agendamentos `
        + `e o Monitoramento MEI. Os arquivos já salvos no PC do robô ficam.\n\nPara confirmar, digite o nome do escritório:`);
      if (!digitado) { e.preventDefault(); return; }
      if (campo.current) campo.current.value = digitado;
    }}>
      <input type="hidden" name="id" value={id} />
      <input ref={campo} type="hidden" name="confirmacao" />
      <button type="submit" className="perigo pequeno" disabled={enviando}>{enviando ? "Excluindo…" : "Excluir escritório"}</button>
      {estado?.erro && <span className="erro-texto">{estado.erro}</span>}
    </form>
  );
}
